// Spike: Electron main that hosts browser tabs as WebContentsViews with remote
// debugging on a random loopback port. Throwaway; see 01-spike.md.
//
// Run: electron/node_modules/.bin/electron docs/superpowers/plans/2026-10-30-agent-browser/spike/main.cjs
// Needs proxy.ts running first (it serves the test page and the side channel).
const { app, BrowserWindow, WebContentsView } = require("electron");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");

const CONTROL_PORT = 9335;
const PROXY = "http://127.0.0.1:9333";
const PAGE = "http://127.0.0.1:9340/";
const HIDDEN_SIZE = { x: 0, y: 0, width: 1280, height: 800 };

const userData = fs.mkdtempSync(path.join(os.tmpdir(), "tf-spike-"));
app.setPath("userData", userData);
app.commandLine.appendSwitch("remote-debugging-port", "0");
// Remote debugging turns on Blink's AutomationControlled feature (navigator.webdriver === true in
// the main world); the preload's navigator patch only reaches the isolated world.
if (process.env.SPIKE_NO_AUTOMATION_FLAG !== "0")
    app.commandLine.appendSwitch("disable-blink-features", "AutomationControlled");

const tabPrefs = {
    partition: "persist:browser",
    backgroundThrottling: false,
    preload: path.join(__dirname, "preload.cjs"),
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: true,
};

// Prefs re-applied to an existing guest webContents. With `partition` in them, creating any
// WebContentsView after that guest closed crashed main (SIGSEGV). SPIKE_GUEST_PREFS=full keeps it.
function guestPrefs() {
    if (process.env.SPIKE_GUEST_PREFS === "full") return tabPrefs;
    const { partition: _partition, ...rest } = tabPrefs;
    return rest;
}

const log = (...args) => console.log("[main]", ...args);

// A view that was never in a window has a 0x0 viewport (setBounds alone doesn't size it), so
// it can't screenshot and nothing in it is "visible". Never-shown views are parked in one hidden
// window instead. SPIKE_PARK=0 leaves them in no window to reproduce that.
const PARK = process.env.SPIKE_PARK !== "0";
// A closed webContents leaves its WebContentsView in the window; the next addChildView on that
// window crashed main with SIGSEGV. Remove the view on "destroyed". SPIKE_UNPARK=0 skips it.
function unparkOnDestroy(view) {
    if (process.env.SPIKE_UNPARK === "0") return;
    view.webContents.once("destroyed", () => {
        for (const w of [parkWin, win])
            if (w && !w.isDestroyed()) w.contentView.removeChildView(view);
    });
}
function park(view) {
    unparkOnDestroy(view);
    if (PARK) {
        parkWin ??= new BrowserWindow({
            show: false,
            paintWhenInitiallyHidden: true,
            width: 1280,
            height: 800,
        });
        parkWin.contentView.addChildView(view);
    }
    view.setBounds(HIDDEN_SIZE);
}

/** name -> { view, targetId, parentTargetId, path } */
const tabs = new Map();
let win = null;
let parkWin = null;
let debugPort = 0;
let appTargetId = null;
let parkTargetId = null; // the park window's own renderer: not a tab, so it is an app target
let childSeq = 0;

async function targetInfoOf(wc) {
    const dbg = wc.debugger;
    const wasAttached = dbg.isAttached();
    if (!wasAttached) dbg.attach("1.3");
    try {
        const r = await dbg.sendCommand("Target.getTargetInfo");
        return r.targetInfo;
    } finally {
        if (!wasAttached) dbg.detach();
    }
}

async function readDevToolsActivePort() {
    const file = path.join(userData, "DevToolsActivePort");
    for (let i = 0; i < 100; i++) {
        if (fs.existsSync(file)) {
            const text = fs.readFileSync(file, "utf8");
            const [port, wsPath] = text.split("\n");
            return { file, text, port: Number(port), wsPath };
        }
        await new Promise((r) => setTimeout(r, 50));
    }
    throw new Error("DevToolsActivePort never appeared");
}

function formatPostDataHeaders(postBody) {
    if (!postBody) return undefined;
    let ct = `content-type: ${postBody.contentType}`;
    if (postBody.boundary) ct += `; boundary=${postBody.boundary}`;
    return ct;
}

async function registerChild(name, view, parentTargetId, how) {
    const info = await targetInfoOf(view.webContents);
    const entry = tabs.get(name);
    if (entry) entry.targetId = info.targetId;
    log(
        "child",
        name,
        how,
        "targetId",
        info.targetId,
        "parent",
        parentTargetId,
        "ctx",
        info.browserContextId,
    );
    await fetch(`${PROXY}/side/child`, {
        method: "POST",
        body: JSON.stringify({ parentTargetId, targetId: info.targetId, how, name }),
    }).catch((e) => log("side channel failed", String(e)));
    return info.targetId;
}

function installPopups(view, name) {
    view.webContents.setWindowOpenHandler((details) => {
        log("open handler", name, {
            url: details.url,
            frameName: details.frameName,
            features: details.features,
            disposition: details.disposition,
            referrer: details.referrer,
            postBody: details.postBody
                ? { contentType: details.postBody.contentType, boundary: details.postBody.boundary }
                : undefined,
        });
        return {
            action: "allow",
            overrideBrowserWindowOptions: { webPreferences: tabPrefs },
            createWindow: (options) => {
                const guest = options.webContents;
                const childName = `${name}.popup${++childSeq}`;
                let view;
                let how;
                if (guest) {
                    how = "guest";
                    // WebContentsView re-applies its webPreferences to an existing webContents
                    // (SetFromDictionary); without them the guest's prefs are reset and the
                    // preload is lost. SPIKE_GUEST_PREFS=0 reproduces that.
                    view =
                        process.env.SPIKE_GUEST_PREFS === "0"
                            ? new WebContentsView({ webContents: guest })
                            : new WebContentsView({
                                  webContents: guest,
                                  webPreferences: guestPrefs(),
                              });
                } else {
                    how = "no-guest";
                    view = new WebContentsView({ webPreferences: tabPrefs });
                    view.webContents.loadURL(details.url, {
                        httpReferrer: details.referrer,
                        postData: details.postBody?.data,
                        extraHeaders: formatPostDataHeaders(details.postBody),
                    });
                }
                log(
                    "createWindow",
                    childName,
                    how,
                    "has webContents key:",
                    "webContents" in options,
                    "options.webPreferences.preload:",
                    options.webPreferences?.preload,
                    "lastPrefs:",
                    JSON.stringify(view.webContents.getLastWebPreferences?.() ?? null),
                );
                view.webContents.on("preload-error", (_e, p, err) =>
                    log("preload-error", childName, p, String(err)),
                );
                park(view);
                const parent = tabs.get(name);
                tabs.set(childName, {
                    view,
                    targetId: null,
                    parentTargetId: parent?.targetId,
                    how,
                });
                installPopups(view, childName);
                view.webContents.once("destroyed", () => tabs.delete(childName));
                void registerChild(childName, view, parent?.targetId, how);
                return view.webContents;
            },
        };
    });
}

function makeTab(name, url) {
    const view = new WebContentsView({ webPreferences: tabPrefs });
    park(view);
    installPopups(view, name);
    void view.webContents.loadURL(url);
    tabs.set(name, { view, targetId: null, parentTargetId: null, how: "tab" });
    return view;
}

function findByTarget(targetId) {
    for (const [name, t] of tabs) if (t.targetId === targetId) return [name, t];
    return [null, null];
}

function readBody(req) {
    return new Promise((resolve) => {
        let data = "";
        req.on("data", (c) => (data += c));
        req.on("end", () => resolve(data ? JSON.parse(data) : {}));
    });
}

function infoJson() {
    const out = {};
    for (const [name, t] of tabs) {
        const wc = t.view.webContents;
        out[name] = {
            targetId: t.targetId,
            parentTargetId: t.parentTargetId,
            how: t.how,
            destroyed: wc.isDestroyed(),
            url: wc.isDestroyed() ? null : wc.getURL(),
        };
    }
    return {
        debugPort,
        userData,
        appTargetId,
        parkTargetId,
        tabs: out,
        aInWindow: win.contentView.children.includes(tabs.get("A").view),
    };
}

function startControlServer() {
    const server = http.createServer(async (req, res) => {
        const send = (code, body) => {
            res.writeHead(code, { "content-type": "application/json" });
            res.end(JSON.stringify(body));
        };
        try {
            const a = tabs.get("A");
            if (req.url === "/info") return send(200, infoJson());
            if (req.url === "/a/detach") {
                win.contentView.removeChildView(a.view);
                a.view.setBounds(HIDDEN_SIZE);
                return send(200, { ok: true });
            }
            if (req.url === "/a/attach") {
                if (parkWin) parkWin.contentView.removeChildView(a.view);
                win.contentView.addChildView(a.view);
                a.view.setBounds({ x: 0, y: 0, width: 800, height: 600 });
                return send(200, { ok: true });
            }
            if (req.url === "/a/park") {
                win.contentView.removeChildView(a.view);
                parkWin ??= new BrowserWindow({
                    show: false,
                    paintWhenInitiallyHidden: true,
                    width: 1280,
                    height: 800,
                });
                parkWin.contentView.addChildView(a.view);
                a.view.setBounds(HIDDEN_SIZE);
                return send(200, { ok: true });
            }
            if (req.url.startsWith("/win/")) {
                const op = req.url.slice(5);
                if (op === "hide") win.hide();
                if (op === "show") win.show();
                if (op === "minimize") win.minimize();
                if (op === "restore") win.restore();
                return send(200, {
                    ok: true,
                    visible: win.isVisible(),
                    minimized: win.isMinimized(),
                });
            }
            if (req.url === "/create-child") {
                const body = await readBody(req);
                const name = `A.created${++childSeq}`;
                const view = new WebContentsView({ webPreferences: tabPrefs });
                park(view);
                tabs.set(name, {
                    view,
                    targetId: null,
                    parentTargetId: body.parentTargetId,
                    how: "created",
                });
                installPopups(view, name);
                view.webContents.once("destroyed", () => tabs.delete(name));
                // Wait for the first load: replying before it lets the client's own navigation be
                // interrupted by this one ("interrupted by another navigation to about:blank").
                await view.webContents
                    .loadURL(body.url || "about:blank")
                    .catch((e) => log("create-child load", String(e)));
                const targetId = await registerChild(name, view, body.parentTargetId, "created");
                return send(200, { targetId });
            }
            if (req.url.startsWith("/exp?")) {
                // Bisect helper: run create-child's steps one at a time.
                const steps = new URL(req.url, "http://x").searchParams.get("steps").split(",");
                const done = [];
                let view = null;
                for (const step of steps) {
                    log("exp step", step);
                    if (step === "new") view = new WebContentsView({ webPreferences: tabPrefs });
                    if (step === "bounds") view.setBounds(HIDDEN_SIZE);
                    if (step === "park") park(view);
                    if (step === "load") await view.webContents.loadURL("about:blank");
                    if (step === "dbg") await targetInfoOf(view.webContents);
                    if (step === "gc") global.gc?.();
                    done.push(step);
                }
                return send(200, { done });
            }
            if (req.url === "/close-target") {
                const body = await readBody(req);
                const [name, t] = findByTarget(body.targetId);
                if (!t) return send(404, { error: "unknown target" });
                if (name === "A" || name === "B")
                    return send(400, { error: "refusing to close a root tab" });
                if (process.env.SPIKE_REMOVE_BEFORE_CLOSE !== "0")
                    for (const w of [parkWin, win])
                        if (w && !w.isDestroyed()) w.contentView.removeChildView(t.view);
                t.view.webContents.close();
                return send(200, { ok: true });
            }
            if (req.url === "/reset") {
                for (const [name, t] of [...tabs]) {
                    if (name === "A" || name === "B") continue;
                    if (!t.view.webContents.isDestroyed()) t.view.webContents.close();
                    tabs.delete(name);
                }
                if (parkWin) parkWin.contentView.removeChildView(a.view);
                win.contentView.addChildView(a.view);
                a.view.setBounds({ x: 0, y: 0, width: 800, height: 600 });
                await a.view.webContents.loadURL(PAGE);
                return send(200, { ok: true });
            }
            if (req.url === "/debugger-test") {
                // Attach webContents.debugger while a remote client is connected.
                const wc = a.view.webContents;
                wc.debugger.attach("1.3");
                const r = await wc.debugger.sendCommand("Runtime.evaluate", {
                    expression: "document.title",
                    returnByValue: true,
                });
                wc.debugger.detach();
                return send(200, { ok: true, title: r.result.value });
            }
            send(404, { error: "not found" });
        } catch (e) {
            send(500, { error: String(e && e.stack ? e.stack : e) });
        }
    });
    server.listen(CONTROL_PORT, "127.0.0.1", () => log("control server on", CONTROL_PORT));
}

app.on("window-all-closed", () => {
    // Keep running: tabs live in main, not in a window.
});

app.whenReady().then(async () => {
    const dap = await readDevToolsActivePort();
    debugPort = dap.port;
    log("DevToolsActivePort", JSON.stringify(dap));

    win = new BrowserWindow({ width: 900, height: 700, title: "spike app" });
    await win.loadURL("data:text/html,<h1>app</h1>");

    const a = makeTab("A", PAGE);
    makeTab("B", "https://example.com");
    if (parkWin) parkWin.contentView.removeChildView(a);
    win.contentView.addChildView(a);
    a.setBounds({ x: 0, y: 0, width: 800, height: 600 });

    for (const name of ["A", "B"]) {
        const info = await targetInfoOf(tabs.get(name).view.webContents);
        tabs.get(name).targetId = info.targetId;
        log(name, "targetId", info.targetId, "type", info.type, "ctx", info.browserContextId);
    }
    const appInfo = await targetInfoOf(win.webContents);
    appTargetId = appInfo.targetId;
    log("app window targetId", appTargetId, "ctx", appInfo.browserContextId);
    if (parkWin) parkTargetId = (await targetInfoOf(parkWin.webContents)).targetId;
    log("park window targetId", parkTargetId);
    startControlServer();
    log("READY", JSON.stringify(infoJson()));
});
