import { describe, expect, it } from "bun:test";

// Regression guard for the root bunfig.toml test preload list. The UI
// package's component-test preload (`packages/ui/tests/preload.ts`) installs
// happy-dom's `GlobalRegistrator` so `AttributesSection.test.tsx` etc. have a
// DOM, but that preload runs for *every* test in the monorepo, backend
// included. happy-dom's `Window` overwrites `setTimeout`/`clearTimeout`/
// `fetch`/`Response`/... on `globalThis` with implementations that behave
// differently from Bun's (e.g. happy-dom's `setTimeout` swallows a throw
// inside the callback instead of failing the test, and its `Response` differs
// from the one `Bun.serve` uses in production).
//
// If the UI preload ever registers happy-dom without restoring these natives
// afterward, this test fails -- catching the regression here rather than via
// a backend test that starts silently passing when it shouldn't.
describe("test environment globals", () => {
    it("setTimeout is Bun's native, not happy-dom's", () => {
        // happy-dom's setTimeout is a plain JS function (source is readable,
        // and it wraps callbacks in try/catch); Bun's native reports
        // "[native code]" and has no catchable wrapper around the callback.
        expect(String(setTimeout)).toContain("[native code]");
    });

    it("Response is Bun's native, not happy-dom's", () => {
        expect(String(Response)).toContain("[native code]");
    });
});
