// Spike client: Playwright for Node over the filtering proxy. Throwaway; see 01-spike.md.
// Run: PW=<path to playwright-core> node docs/superpowers/plans/2026-10-30-agent-browser/spike/client-playwright.mjs
import { writeFileSync } from "node:fs";

const { chromium } = await import(process.env.PW ?? "playwright-core");
const MAIN = "http://127.0.0.1:9335";
const PROXY = "http://127.0.0.1:9333";
const PAGE = "http://127.0.0.1:9340/";
const OUT = process.env.OUT ?? "/tmp";
const NAME = process.env.NAME ?? "playwright-node";

const results = {};
const facts = {};
const pass = (k, ok, note = "") => {
    results[k] = { ok, note };
    console.log(`${ok ? "PASS" : "FAIL"} ${k} ${note}`);
};
const post = (u, body = "") => fetch(u, { method: "POST", body });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const timeout = (p, ms, what) =>
    Promise.race([
        p,
        new Promise((_, rej) => setTimeout(() => rej(new Error(`timeout: ${what}`)), ms)),
    ]);
const raf = (p) =>
    Promise.race([
        p
            .evaluate(() => new Promise((r) => requestAnimationFrame(() => r("raf ok"))))
            .catch((e) => `ERR ${e.message}`),
        sleep(2000).then(() => "raf TIMEOUT"),
    ]);
facts.raf = {};
async function attempt(k, fn) {
    if (page) facts.raf[`before ${k}`] = await raf(page);
    try {
        await fn();
    } catch (e) {
        pass(k, false, String(e?.message ?? e).split("\n")[0]);
    }
}

await post(`${MAIN}/reset`);
await post(`${PROXY}/log/mark`, NAME);
const browser = await chromium.connectOverCDP(PROXY);
const allPages = () => browser.contexts().flatMap((c) => c.pages());
let page;

await attempt("1-one-page", async () => {
    const pages = allPages();
    facts.contexts = browser.contexts().length;
    facts.pageUrls = pages.map((p) => p.url());
    page = pages[0];
    pass(
        "1-one-page",
        pages.length === 1 && pages[0].url().startsWith(PAGE),
        JSON.stringify(facts.pageUrls),
    );
});
const ctx = page.context();

await attempt("2-drive", async () => {
    await page.goto(`${PAGE}?nav=1`);
    await page.fill("#inp", "hello");
    await page.click("#btn");
    const out = await page.textContent("#out");
    pass("2-drive", out === "clicked" && (await page.inputValue("#inp")) === "hello", `out=${out}`);
});

await attempt("3-hidden", async () => {
    // A view removed from every window keeps painting only while the client that saw it stays
    // connected; after a reconnect rAF is dead and clicks hang. Hidden tabs are parked instead.
    // HIDE=detach reproduces the removed-from-window variant.
    const hide = process.env.HIDE ?? "park";
    await post(`${MAIN}/a/${hide}`);
    await sleep(300);
    let shot;
    let how = hide === "park" ? "parked hidden window" : "removed from window";
    try {
        shot = await timeout(page.screenshot(), 10000, "screenshot (removed)");
    } catch (e) {
        facts.removedScreenshotError = String(e.message);
        await post(`${MAIN}/a/park`);
        how = "parked hidden window";
        shot = await timeout(page.screenshot(), 10000, "screenshot (parked)");
    }
    writeFileSync(`${OUT}/${NAME}-hidden.png`, shot);
    const c1 = Number(await page.textContent("#count"));
    await sleep(2000);
    const c2 = Number(await page.textContent("#count"));
    await page.evaluate(() => (document.getElementById("out").textContent = ""));
    await page.click("#btn");
    const out = await page.textContent("#out");
    facts.hidden = { how, bytes: shot.length, c1, c2 };
    pass(
        "3-hidden",
        shot.length > 20000 && c2 - c1 > 15 && out === "clicked",
        JSON.stringify(facts.hidden),
    );
});

facts.popups = {};
for (const [sel, kind, expectOpener] of [
    ["#blank", "blank", false],
    ["#opener", "opener", true],
    ["#wopen", "wopen", true],
]) {
    await attempt(`4-popup-${kind}`, async () => {
        const [pop] = await Promise.all([
            ctx.waitForEvent("page", { timeout: 10000 }),
            page.click(sel),
        ]);
        facts.raf[`popup ${kind}`] = await raf(pop);
        await pop.waitForSelector("#info:not(:empty)", { timeout: 5000 });
        const info = JSON.parse(await pop.textContent("#info"));
        const c1 = Number(await pop.textContent("#count"));
        await sleep(1000);
        const c2 = Number(await pop.textContent("#count"));
        await pop.click("#pbtn");
        const out = await pop.textContent("#pout");
        facts.popups[kind] = {
            opener: info.opener,
            preload: info.preload,
            webdriver: info.webdriver,
            c1,
            c2,
        };
        pass(
            `4-popup-${kind}`,
            info.opener === expectOpener && info.preload && c2 - c1 > 5 && out === "clicked",
            JSON.stringify(facts.popups[kind]),
        );
        await timeout(pop.close(), 5000, "popup close").catch(
            (e) => (facts[`close-${kind}`] = String(e.message)),
        );
    });
}

for (const [sel, kind, ct, field] of [
    ["#f1s", "urlenc", "application/x-www-form-urlencoded", ["a", "1"]],
    ["#f2s", "multi", "multipart/form-data; boundary=", ["b", "2"]],
]) {
    await attempt(`4b-form-${kind}`, async () => {
        const [pop] = await Promise.all([
            ctx.waitForEvent("page", { timeout: 10000 }),
            page.click(sel),
        ]);
        await pop.waitForSelector("#echo", { timeout: 5000 });
        const echo = JSON.parse(await pop.textContent("#echo"));
        const info = JSON.parse(await pop.textContent("#info"));
        facts[`form-${kind}`] = { ...echo, opener: info.opener, preload: info.preload };
        pass(
            `4b-form-${kind}`,
            String(echo.contentType).startsWith(ct) &&
                echo.fields[field[0]] === field[1] &&
                info.preload,
            JSON.stringify(facts[`form-${kind}`]),
        );
        await timeout(pop.close(), 5000, "form popup close").catch(() => {});
    });
}

await attempt("cookies", async () => {
    await ctx.addCookies([{ name: "added", value: "1", url: PAGE }]);
    const cookies = await ctx.cookies();
    facts.cookies = cookies.map((c) => `${c.name}@${c.domain}`);
    const pageSees = await page.evaluate(() => document.cookie);
    facts.pageDocumentCookie = pageSees;
    pass(
        "cookies",
        facts.cookies.includes("spike@127.0.0.1") &&
            facts.cookies.includes("added@127.0.0.1") &&
            pageSees.includes("added=1"),
        JSON.stringify({ cookies: facts.cookies, pageSees }),
    );
});

await attempt("debugger-test", async () => {
    const r = await (await post(`${MAIN}/debugger-test`)).json();
    const v = await page.evaluate(() => 1 + 1);
    facts.debuggerTest = { main: r, clientEvalAfter: v };
    console.log("debugger-test:", JSON.stringify(facts.debuggerTest));
});

await attempt("6-newPage", async () => {
    const np = await timeout(ctx.newPage(), 10000, "newPage");
    await np.goto(`${PAGE}popup?k=new`);
    const info = JSON.parse(await np.textContent("#info"));
    facts.newPage = { url: np.url(), preload: info.preload };
    pass("6-newPage", info.preload === true, JSON.stringify(facts.newPage));
    await timeout(np.close(), 5000, "newPage close").catch(
        (e) => (facts.newPageClose = String(e.message)),
    );
});

await attempt("5-close", async () => {
    await timeout(browser.close(), 10000, "browser.close");
    await sleep(500);
    const info = await (await fetch(`${MAIN}/info`)).json();
    const a = info.tabs.A;
    facts.afterClose = { aDestroyed: a.destroyed, aUrl: a.url, tabs: Object.keys(info.tabs) };
    pass("5-close", !a.destroyed && a.url.startsWith(PAGE), JSON.stringify(facts.afterClose));
});

console.log("raf:", JSON.stringify(facts.raf));
writeFileSync(`${OUT}/${NAME}.json`, JSON.stringify({ results, facts }, null, 2));
process.exit(0);
