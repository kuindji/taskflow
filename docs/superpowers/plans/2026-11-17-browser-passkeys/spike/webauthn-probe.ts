// WebAuthn probe for a Taskflow browser tab, driven over the tab's CDP endpoint.
//
// Not product code. Run it from a scratch dir that has playwright-core installed:
//   cd <scratch> && bun add playwright-core@1.48.2
//   bun <repo>/docs/superpowers/plans/2026-11-17-browser-passkeys/spike/webauthn-probe.ts \
//     <cdp-endpoint> <scratch>/node_modules/playwright-core/index.mjs [url] [--uvpaa-only]
//
// --uvpaa-only skips the platform create(). Use it on a build where Touch ID is
// configured: there create() opens a real Touch ID dialog on the owner's screen.
//
// url defaults to https://example.com (a page that makes no WebAuthn calls of its own;
// webauthn.io starts a conditional-mediation get() on load, so a create() there fails
// with "A request is already pending").
//
// Prints JSON: hasPKC, ua, uvpaa (isUserVerifyingPlatformAuthenticatorAvailable),
// cma (isConditionalMediationAvailable), create (how a platform create() settled, or "skipped"),
// ms (how long it took).
//
// Chromium clamps WebAuthn timeouts to at least 3 minutes, so a serviced request that
// waits for a finger is still pending at 20 s. The probe aborts create() at 20 s and
// reports "pending at 20s, aborted"; that result alone does not mean "not serviced".
// The automated signal is uvpaa; the functional check is a real Touch ID touch.
//
// Lives under spike/ so repo lint skips it (it isn't in any workspace tsconfig).
//
// Baseline on Electron 33.4.11 (2026-11-17): uvpaa false, create pending at 20 s.

const args = process.argv.slice(2);
const uvpaaOnly = args.includes("--uvpaa-only");
const [endpoint, playwrightPath, url = "https://example.com"] = args.filter(
    (a) => a !== "--uvpaa-only",
);
if (!endpoint || !playwrightPath) {
    console.error(
        "usage: webauthn-probe.ts <cdp-endpoint> <playwright-core path> [url] [--uvpaa-only]",
    );
    process.exit(2);
}

type Playwright = typeof import("playwright-core");
const { chromium } = (await import(playwrightPath)) as Playwright;
const browser = await chromium.connectOverCDP(endpoint);
const page = browser.contexts()[0]?.pages()[0];
if (!page) throw new Error("no page on this endpoint");
await page.goto(url);

const result = await page.evaluate(async (skipCreate) => {
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
    if (skipCreate) {
        out.create = "skipped";
        return out;
    }
    const started = Date.now();
    const controller = new AbortController();
    try {
        const pending = navigator.credentials.create({
            signal: controller.signal,
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
        const timer = setTimeout(() => controller.abort(), 20000);
        try {
            await pending;
            out.create = "resolved";
        } finally {
            clearTimeout(timer);
        }
    } catch (e) {
        if (controller.signal.aborted) out.create = "pending at 20s, aborted";
        else out.create = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
    }
    out.ms = Date.now() - started;
    return out;
}, uvpaaOnly);

console.log(JSON.stringify(result, null, 2));
await browser.close();
