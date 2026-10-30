# Spike client: Playwright for Python over the filtering proxy. Throwaway; see 01-spike.md.
# Run: uv run --no-project --with playwright python docs/superpowers/plans/2026-10-30-agent-browser/spike/client_playwright.py
import json
import os
import time
import urllib.request

from playwright.sync_api import sync_playwright

MAIN = "http://127.0.0.1:9335"
PROXY = "http://127.0.0.1:9333"
PAGE = "http://127.0.0.1:9340/"
OUT = os.environ.get("OUT", "/tmp")
NAME = os.environ.get("NAME", "playwright-python")

results = {}
facts = {}


def ok(k, good, note=""):
    results[k] = {"ok": bool(good), "note": note}
    print(f"{'PASS' if good else 'FAIL'} {k} {note}", flush=True)


def post(url, body=b""):
    req = urllib.request.Request(url, data=body, method="POST")
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read() or b"{}")


def get(url):
    with urllib.request.urlopen(url, timeout=30) as r:
        return json.loads(r.read())


def attempt(k, fn):
    try:
        fn()
    except Exception as e:  # noqa: BLE001 - spike: record any failure
        ok(k, False, str(e).split("\n")[0])


post(f"{MAIN}/reset")
post(f"{PROXY}/log/mark", NAME.encode())

with sync_playwright() as pw:
    browser = pw.chromium.connect_over_cdp(PROXY)
    pages = [p for c in browser.contexts for p in c.pages]
    facts["pageUrls"] = [p.url for p in pages]
    ok("1-one-page", len(pages) == 1 and pages[0].url.startswith(PAGE), json.dumps(facts["pageUrls"]))
    page = pages[0]
    ctx = page.context

    def drive():
        page.goto(f"{PAGE}?nav=1")
        page.fill("#inp", "hello")
        page.click("#btn")
        out = page.text_content("#out")
        ok("2-drive", out == "clicked" and page.input_value("#inp") == "hello", f"out={out}")

    attempt("2-drive", drive)

    def hidden():
        hide = os.environ.get("HIDE", "park")
        post(f"{MAIN}/a/{hide}")
        time.sleep(0.3)
        how = "parked hidden window" if hide == "park" else "removed from window"
        try:
            shot = page.screenshot(timeout=10000)
        except Exception as e:  # noqa: BLE001
            facts["removedScreenshotError"] = str(e)
            post(f"{MAIN}/a/park")
            how = "parked hidden window"
            shot = page.screenshot(timeout=10000)
        with open(f"{OUT}/{NAME}-hidden.png", "wb") as f:
            f.write(shot)
        c1 = int(page.text_content("#count"))
        time.sleep(2)
        c2 = int(page.text_content("#count"))
        page.evaluate("document.getElementById('out').textContent = ''")
        page.click("#btn")
        out = page.text_content("#out")
        facts["hidden"] = {"how": how, "bytes": len(shot), "c1": c1, "c2": c2}
        ok("3-hidden", len(shot) > 20000 and c2 - c1 > 15 and out == "clicked", json.dumps(facts["hidden"]))

    attempt("3-hidden", hidden)

    facts["popups"] = {}
    for sel, kind, expect_opener in [("#blank", "blank", False), ("#opener", "opener", True), ("#wopen", "wopen", True)]:

        def popup(sel=sel, kind=kind, expect_opener=expect_opener):
            with ctx.expect_page(timeout=10000) as info_ev:
                page.click(sel)
            pop = info_ev.value
            pop.wait_for_selector("#info:not(:empty)")
            info = json.loads(pop.text_content("#info"))
            c1 = int(pop.text_content("#count"))
            time.sleep(1)
            c2 = int(pop.text_content("#count"))
            pop.click("#pbtn")
            out = pop.text_content("#pout")
            facts["popups"][kind] = {"opener": info["opener"], "preload": info["preload"], "c1": c1, "c2": c2}
            ok(
                f"4-popup-{kind}",
                info["opener"] == expect_opener and info["preload"] and c2 - c1 > 5 and out == "clicked",
                json.dumps(facts["popups"][kind]),
            )
            try:
                pop.close()
            except Exception as e:  # noqa: BLE001
                facts[f"close-{kind}"] = str(e)

        attempt(f"4-popup-{kind}", popup)

    for sel, kind, ct, field in [
        ("#f1s", "urlenc", "application/x-www-form-urlencoded", ("a", "1")),
        ("#f2s", "multi", "multipart/form-data; boundary=", ("b", "2")),
    ]:

        def form(sel=sel, kind=kind, ct=ct, field=field):
            with ctx.expect_page(timeout=10000) as info_ev:
                page.click(sel)
            pop = info_ev.value
            pop.wait_for_selector("#echo")
            echo = json.loads(pop.text_content("#echo"))
            info = json.loads(pop.text_content("#info"))
            facts[f"form-{kind}"] = {**echo, "opener": info["opener"], "preload": info["preload"]}
            ok(
                f"4b-form-{kind}",
                str(echo["contentType"]).startswith(ct) and echo["fields"].get(field[0]) == field[1] and info["preload"],
                json.dumps(facts[f"form-{kind}"]),
            )
            try:
                pop.close()
            except Exception:  # noqa: BLE001
                pass

        attempt(f"4b-form-{kind}", form)

    def cookies():
        ctx.add_cookies([{"name": "added", "value": "1", "url": PAGE}])
        facts["cookies"] = [f"{c['name']}@{c['domain']}" for c in ctx.cookies()]
        page_sees = page.evaluate("document.cookie")
        ok(
            "cookies",
            "spike@127.0.0.1" in facts["cookies"] and "added@127.0.0.1" in facts["cookies"] and "added=1" in page_sees,
            json.dumps({"cookies": facts["cookies"], "pageSees": page_sees}),
        )

    attempt("cookies", cookies)

    def new_page():
        np = ctx.new_page()
        np.goto(f"{PAGE}popup?k=new")
        info = json.loads(np.text_content("#info"))
        facts["newPage"] = {"url": np.url, "preload": info["preload"]}
        ok("6-newPage", info["preload"] is True, json.dumps(facts["newPage"]))
        try:
            np.close()
        except Exception as e:  # noqa: BLE001
            facts["newPageClose"] = str(e)

    attempt("6-newPage", new_page)

    def close():
        browser.close()
        time.sleep(0.5)
        a = get(f"{MAIN}/info")["tabs"]["A"]
        facts["afterClose"] = {"aDestroyed": a["destroyed"], "aUrl": a["url"]}
        ok("5-close", not a["destroyed"] and a["url"].startswith(PAGE), json.dumps(facts["afterClose"]))

    attempt("5-close", close)

with open(f"{OUT}/{NAME}.json", "w") as f:
    json.dump({"results": results, "facts": facts}, f, indent=2)
