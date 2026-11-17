# Section 3 — Touch ID WebAuthn

**Goal:** In the signed app, browser tabs see a working platform authenticator. `isUserVerifyingPlatformAuthenticatorAvailable()` returns `true`, and `create()` raises the Touch ID prompt. With no touch, `create()` settles with an error instead of hanging. The owner's real-finger check is in Section 4.

**Files:**
- Create: `electron/src/webauthn.ts`, `electron/src/webauthn.test.ts`
- Modify: `electron/src/main.ts` (call it once, early)

**Interfaces:**
- Consumes: the entitlement files from Section 1; Electron 45 typings from Section 2.
- Produces: `configureTouchIdWebAuthn`, `WEBAUTHN_KEYCHAIN_ACCESS_GROUP`, `WebAuthnDeps` (exact shapes in the plan index).

- [ ] **Step 1: Record the base**: `git rev-parse HEAD` into the Section 3 status row.

- [ ] **Step 2: Check the API shape**

Read `electron/node_modules/electron/electron.d.ts` (or the hoisted copy) for `configureWebAuthn`. Note:
- the options type name;
- whether it must be called before or after `ready`;
- whether it's per-app or takes a session.

If any of these differ from the plan index, adjust the names, keep the intent, and record it as a Deviation. If the docs say it must run before `ready`, call it at module top level in `main.ts`, next to the `app.commandLine` switches. Otherwise call it inside the existing `app.whenReady()` path, before the window manager creates any view.

- [ ] **Step 3: Write the failing tests** (`electron/src/webauthn.test.ts`, plain dependency injection, no `mock.module`)

```ts
const options = {
    touchID: {
        keychainAccessGroup: "9SX8S58CA8.com.taskflow.app.webauthn",
        promptReason: "sign in to $1",
    },
};
test("configures Touch ID on packaged macOS", () => {
    const calls: unknown[] = [];
    const ok = configureTouchIdWebAuthn({ platform: "darwin", isPackaged: true, configure: (o) => calls.push(o), warn: () => {} });
    expect(ok).toBe(true);
    expect(calls).toEqual([options]);
});
test("skips unsigned dev runs", () => {
    const calls: unknown[] = [];
    expect(configureTouchIdWebAuthn({ platform: "darwin", isPackaged: false, configure: (o) => calls.push(o), warn: () => {} })).toBe(false);
    expect(calls).toEqual([]);
});
test("skips other platforms", () => {
    const calls: unknown[] = [];
    expect(configureTouchIdWebAuthn({ platform: "win32", isPackaged: true, configure: (o) => calls.push(o), warn: () => {} })).toBe(false);
    expect(calls).toEqual([]);
});
test("a throwing configure is logged, not fatal", () => {
    const warnings: string[] = [];
    const ok = configureTouchIdWebAuthn({ platform: "darwin", isPackaged: true, configure: () => { throw new Error("no entitlement"); }, warn: (m) => warnings.push(m) });
    expect(ok).toBe(false);
    expect(warnings).toHaveLength(1);
});
test("the access group matches the entitlement", () => {
    const plist = readFileSync(join(import.meta.dir, "..", "entitlements.mac.plist"), "utf8");
    expect(plist).toContain(`<string>${WEBAUTHN_KEYCHAIN_ACCESS_GROUP}</string>`);
});
```

Run `cd electron && bun test src/webauthn.test.ts`. Expected: FAIL (module missing).

- [ ] **Step 4: Implement `configureTouchIdWebAuthn(deps: WebAuthnDeps): boolean` in `electron/src/webauthn.ts`**

It does exactly the four behaviours above. `promptReason` is `"sign in to $1"`. Run the tests. Expected: PASS.

- [ ] **Step 5: Wire it in `main.ts`**

Call it at the point chosen in Step 2:

```ts
configureTouchIdWebAuthn({
    platform: process.platform,
    isPackaged: app.isPackaged,
    configure: (o) => app.configureWebAuthn(o),
    warn: (m, e) => console.warn(m, e),
});
```

Then run typecheck, oxlint and `bun test` in `electron`. Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add electron/src/webauthn.ts electron/src/webauthn.test.ts electron/src/main.ts
git commit -m "feat(browser): enable Touch ID passkeys in browser tabs"
```

- [ ] **Step 7: Signed-build check**

Run `bun run package`. Start the binary sandboxed (Facts) and open a tab on `https://example.com` through the API. Then run the probe. Expected:
- `uvpaa: true`;
- `create` is a `NotAllowedError` (or similar) once the 15 s timeout passes with nobody touching. It must not be `still pending after 20s`. That proves requests are serviced.

While `create()` is pending, list the on-screen windows without activating anything (for example `swift -e` with `CGWindowListCopyWindowInfo`, or `screencapture -l <id>` for a window id). Record whether a Touch ID / LocalAuthentication window showed up, as evidence only.

Also confirm `bun run dev:electron` still starts cleanly. The unsigned run logs no WebAuthn error, because the configure call is skipped.

If `uvpaa` is `false` or `create` still hangs, read the app log and the DevTools console for Electron's WebAuthn messages. Check whether the permission policy (`electron/src/browser-host/permission-policy.ts`) is being asked for something WebAuthn-related; add only that exact permission, with a test in `permission-policy.test.ts`. If it still doesn't work after that, stop and notify.

- [ ] **Step 8: Diff review, then hand off**

Run the chain's diff review against the Section 3 base and triage it. In Facts, record the probe output and the path of the signed package (`electron/release/mac-arm64/Taskflow.app`). **Next step** → "Section 4".
