// Spike client: Puppeteer over the filtering proxy. Throwaway; see 01-spike.md.
// Run: PPT=<path to puppeteer-core> node docs/superpowers/plans/2026-10-30-agent-browser/spike/client-puppeteer.mjs
import { writeFileSync } from "node:fs";

const puppeteer = (await import(process.env.PPT ?? "puppeteer-core")).default;
const MAIN = "http://127.0.0.1:9335";
const PROXY = "http://127.0.0.1:9333";
const PAGE = "http://127.0.0.1:9340/";
const OUT = process.env.OUT ?? "/tmp";
const NAME = process.env.NAME ?? "puppeteer";

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
async function attempt(k, fn) {
    try {
        await fn();
    } catch (e) {
        pass(k, false, String(e?.message ?? e).split("\n")[0]);
    }
}
const text = (p, sel) => p.$eval(sel, (el) => el.textContent);

await post(`${MAIN}/reset`);
await post(`${PROXY}/log/mark`, NAME);
const browser = await puppeteer.connect({ browserURL: PROXY, defaultViewport: null });
let page;

await attempt("1-one-page", async () => {
    const pages = await browser.pages();
    facts.pageUrls = pages.map((p) => p.url());
    page = pages[0];
    pass(
        "1-one-page",
        pages.length === 1 && pages[0].url().startsWith(PAGE),
        JSON.stringify(facts.pageUrls),
    );
});

await attempt("2-drive", async () => {
    await page.goto(`${PAGE}?nav=1`);
    await page.type("#inp", "hello");
    await page.click("#btn");
    const out = await text(page, "#out");
    const val = await page.$eval("#inp", (el) => el.value);
    pass("2-drive", out === "clicked" && val === "hello", `out=${out}`);
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
    const c1 = Number(await text(page, "#count"));
    await sleep(2000);
    const c2 = Number(await text(page, "#count"));
    await page.evaluate(() => (document.getElementById("out").textContent = ""));
    await page.click("#btn");
    const out = await text(page, "#out");
    facts.hidden = { how, bytes: shot.length, c1, c2 };
    pass(
        "3-hidden",
        shot.length > 20000 && c2 - c1 > 15 && out === "clicked",
        JSON.stringify(facts.hidden),
    );
});

async function popupFrom(sel) {
    const created = browser.waitForTarget(
        (t) =>
            t.opener() === page.target() || t.url().includes("/popup") || t.url().includes("/echo"),
        {
            timeout: 10000,
        },
    );
    const before = new Set((await browser.pages()).map((p) => p.target()));
    await page.click(sel);
    const t = await created.catch(async () => {
        const after = (await browser.pages()).map((p) => p.target());
        return after.find((x) => !before.has(x));
    });
    if (!t) throw new Error("no new target");
    const p = await t.page();
    if (!p) throw new Error(`target ${t.type()} has no page`);
    return p;
}

facts.popups = {};
for (const [sel, kind, expectOpener] of [
    ["#blank", "blank", false],
    ["#opener", "opener", true],
    ["#wopen", "wopen", true],
]) {
    await attempt(`4-popup-${kind}`, async () => {
        const pop = await popupFrom(sel);
        await pop.waitForFunction(() => document.getElementById("info")?.textContent, {
            timeout: 10000,
        });
        const info = JSON.parse(await text(pop, "#info"));
        const c1 = Number(await text(pop, "#count"));
        await sleep(1000);
        const c2 = Number(await text(pop, "#count"));
        await pop.click("#pbtn");
        const out = await text(pop, "#pout");
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
        const pop = await popupFrom(sel);
        await pop.waitForSelector("#echo", { timeout: 10000 });
        const echo = JSON.parse(await text(pop, "#echo"));
        const info = JSON.parse(await text(pop, "#info"));
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
    facts.pageCookies = (await page.cookies()).map((c) => `${c.name}@${c.domain}`);
    console.log("page.cookies():", JSON.stringify(facts.pageCookies));
    await browser.setCookie({ name: "added", value: "1", domain: "127.0.0.1", path: "/" });
    facts.browserCookies = (await browser.cookies()).map((c) => `${c.name}@${c.domain}`);
    const pageSees = await page.evaluate(() => document.cookie);
    pass(
        "cookies",
        facts.browserCookies.includes("spike@127.0.0.1") &&
            facts.browserCookies.includes("added@127.0.0.1") &&
            pageSees.includes("added=1"),
        JSON.stringify({
            pageCookies: facts.pageCookies,
            browserCookies: facts.browserCookies,
            pageSees,
        }),
    );
});

await attempt("6-newPage", async () => {
    const np = await timeout(browser.newPage(), 10000, "newPage");
    await np.goto(`${PAGE}popup?k=new`);
    const info = JSON.parse(await text(np, "#info"));
    facts.newPage = { url: np.url(), preload: info.preload };
    pass("6-newPage", info.preload === true, JSON.stringify(facts.newPage));
    await timeout(np.close(), 5000, "newPage close").catch(
        (e) => (facts.newPageClose = String(e.message)),
    );
});

await attempt("5-close", async () => {
    await timeout(browser.close(), 10000, "browser.close").catch(
        (e) => (facts.closeError = String(e.message)),
    );
    await sleep(500);
    const info = await (await fetch(`${MAIN}/info`)).json();
    const a = info.tabs.A;
    facts.afterClose = { aDestroyed: a.destroyed, aUrl: a.url, tabs: Object.keys(info.tabs) };
    pass("5-close", !a.destroyed && a.url.startsWith(PAGE), JSON.stringify(facts.afterClose));
});

writeFileSync(`${OUT}/${NAME}.json`, JSON.stringify({ results, facts }, null, 2));
process.exit(0);
