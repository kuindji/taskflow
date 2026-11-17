// WebAuthn probe for a Taskflow browser tab, driven over the tab's CDP endpoint.
//
// Not product code. Run it from a scratch dir that has playwright-core installed:
//   cd <scratch> && bun add playwright-core@1.48.2
//   bun <repo>/docs/superpowers/plans/2026-11-17-browser-passkeys/probe/webauthn-probe.ts \
//     <cdp-endpoint> <scratch>/node_modules/playwright-core/index.mjs [url]
//
// url defaults to https://example.com (a page that makes no WebAuthn calls of its own;
// webauthn.io starts a conditional-mediation get() on load, so a create() there fails
// with "A request is already pending").
//
// Prints JSON: hasPKC, ua, uvpaa (isUserVerifyingPlatformAuthenticatorAvailable),
// cma (isConditionalMediationAvailable), create (result of a 15 s create()),
// ms (how long create() took to settle, or the race limit).
//
// Baseline on Electron 33.4.11 (2026-11-17): uvpaa false, create "still pending after 20s".

const [endpoint, playwrightPath, url = "https://example.com"] = process.argv.slice(2);
if (!endpoint || !playwrightPath) {
    console.error("usage: webauthn-probe.ts <cdp-endpoint> <playwright-core path> [url]");
    process.exit(2);
}

type Playwright = typeof import("playwright-core");
const { chromium } = (await import(playwrightPath)) as Playwright;
const browser = await chromium.connectOverCDP(endpoint);
const page = browser.contexts()[0]?.pages()[0];
if (!page) throw new Error("no page on this endpoint");
await page.goto(url);

const result = await page.evaluate(async () => {
    const out: Record<string, unknown> = {};
    out.hasPKC = typeof PublicKeyCredential !== "undefined";
    out.ua = navigator.userAgent;
    try {
        out.uvpaa = await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
    } catch (e) {
        out.uvpaa = String(e);
    }
    try {
        out.cma = await PublicKeyCredential.isConditionalMediationAvailable();
    } catch (e) {
        out.cma = String(e);
    }
    const started = Date.now();
    try {
        const pending = navigator.credentials.create({
            publicKey: {
                challenge: crypto.getRandomValues(new Uint8Array(32)),
                rp: { name: "probe", id: location.hostname },
                user: {
                    id: crypto.getRandomValues(new Uint8Array(16)),
                    name: "probe",
                    displayName: "probe",
                },
                pubKeyCredParams: [{ type: "public-key", alg: -7 }],
                authenticatorSelection: {
                    authenticatorAttachment: "platform",
                    residentKey: "required",
                    userVerification: "required",
                },
                timeout: 15000,
            },
        });
        out.create = await Promise.race([
            pending.then(() => "resolved"),
            new Promise((resolve) => setTimeout(() => resolve("still pending after 20s"), 20000)),
        ]);
    } catch (e) {
        out.create = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
    }
    out.ms = Date.now() - started;
    return out;
});

console.log(JSON.stringify(result, null, 2));
await browser.close();
