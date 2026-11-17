# Section 3 — Touch ID WebAuthn

**Goal:** In the signed app, browser tabs see a working platform authenticator. `isUserVerifyingPlatformAuthenticatorAvailable()` returns `true`, `create()` is serviced, and passkey sign-in (`get()` with discoverable credentials) can pick an account. The owner's real-finger checks are in Section 4.

Electron 45 cancels every discoverable Touch ID `get()` with `NotAllowedError`, even when only one credential matches, unless the session has a `select-webauthn-account` listener (`docs/api/session.md` at v45.3.3). So this section adds that listener as well as `configureWebAuthn`. Chromium asks for Touch ID first and only then passes the matching accounts to the listener (`device/fido/mac/get_assertion_operation.mm`: `PromptTouchId` → `GenerateResponses`; then `AuthenticatorCommonImpl::OnSignResponse` → `SelectAccount`, Chromium 156.0.8078.100). So the user touches first, then chooses:
- one matching account → picked automatically;
- several → a native `dialog.showMessageBox` lists them, plus Cancel;
- none, Cancel, or an error → the request is cancelled (`NotAllowedError` in the page).

**Files:**
- Create: `electron/src/webauthn.ts`, `electron/src/webauthn.test.ts`
- Modify: `electron/src/main.ts` (configure once, early; register the listener on the `persist:browser` session)

**Interfaces:**
- Consumes: the entitlement files and profile from Section 1; Electron 45 typings from Section 2.
- Produces: `configureTouchIdWebAuthn`, `handleWebAuthnAccountSelection`, `WEBAUTHN_KEYCHAIN_ACCESS_GROUP`, `WebAuthnDeps` (exact shapes in the plan index).
- `webauthn.ts` imports Electron **types only** (`import type`), so its test runs under plain `bun test`. The dialog-based chooser lives in `main.ts`.

- [ ] **Step 1: Record the base**: `git rev-parse HEAD` into the Section 3 status row.

- [ ] **Step 2: Check the API shape**

Checked during plan review against `electron@45.3.3/electron.d.ts`: `app.configureWebAuthn(options: ConfigureWebAuthnOptions): void` (per-app, macOS). `Session` `on('select-webauthn-account', (event, details: SelectWebauthnAccountDetails, callback: (credentialId?: string | null) => void))`. `WebAuthnAccount` has `credentialId`, optional `userHandle`, `name`, `displayName`. Confirm these in the installed `electron.d.ts`. If anything differs, adjust the names, keep the intent, and record a Deviation.

Call both inside the existing `app.whenReady()` path, before the window manager creates any view (this matches the docs' examples).

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

// Account selection. `answers` records every callback argument; each test checks it ran exactly once.
const alice = { credentialId: "aaaaaaaaaaaa", name: "alice@example.com" };
const bob = { credentialId: "bbbbbbbbbbbb", displayName: "Bob" };
const anon = { credentialId: "cccccccccccc" };
function run(accounts: Electron.WebAuthnAccount[], choose: (rp: string, labels: string[]) => Promise<number | null>) {
    const answers: unknown[] = [];
    const warnings: string[] = [];
    const done = handleWebAuthnAccountSelection(
        { relyingPartyId: "example.com", accounts },
        (id) => answers.push(id),
        choose,
        (m) => warnings.push(m),
    );
    return { answers, warnings, done };
}
test("a single account is picked without asking", async () => {
    let asked = false;
    const r = run([alice], async () => { asked = true; return 0; });
    await r.done;
    expect(asked).toBe(false);
    expect(r.answers).toEqual(["aaaaaaaaaaaa"]);
});
test("several accounts ask, with readable labels", async () => {
    let seen: [string, string[]] | undefined;
    const r = run([alice, bob, anon], async (rp, labels) => { seen = [rp, labels]; return 1; });
    await r.done;
    expect(seen).toEqual(["example.com", ["alice@example.com", "Bob", "Passkey cccccccc"]]);
    expect(r.answers).toEqual(["bbbbbbbbbbbb"]);
});
test("cancelling the choice cancels the request", async () => {
    const r = run([alice, bob], async () => null);
    await r.done;
    expect(r.answers).toEqual([undefined]);
});
test("an out-of-range choice cancels the request", async () => {
    const r = run([alice, bob], async () => 5);
    await r.done;
    expect(r.answers).toEqual([undefined]);
});
test("a failing chooser is logged and cancels", async () => {
    const r = run([alice, bob], async () => { throw new Error("no window"); });
    await r.done;
    expect(r.answers).toEqual([undefined]);
    expect(r.warnings).toHaveLength(1);
});
test("no accounts cancels without asking", async () => {
    let asked = false;
    const r = run([], async () => { asked = true; return 0; });
    await r.done;
    expect(asked).toBe(false);
    expect(r.answers).toEqual([undefined]);
});
```

Run `cd electron && bun test src/webauthn.test.ts`. Expected: FAIL (module missing).

- [ ] **Step 4: Implement `electron/src/webauthn.ts`**

- `configureTouchIdWebAuthn(deps: WebAuthnDeps): boolean` does exactly the first four behaviours above. `promptReason` is `"sign in to $1"`.
- `handleWebAuthnAccountSelection(details, callback, choose, warn): Promise<void>` does the account behaviours above. Labels are `name`, else `displayName`, else `Passkey <first 8 chars of credentialId>`. Cancel by calling `callback()` with no argument. Call `callback` exactly once on every path (`try … finally`).

Run the tests. Expected: PASS.

- [ ] **Step 5: Wire it in `main.ts`**

At the point chosen in Step 2:

```ts
const touchIdReady = configureTouchIdWebAuthn({
    platform: process.platform,
    isPackaged: app.isPackaged,
    configure: (o) => app.configureWebAuthn(o),
    warn: (m, e) => console.warn(m, e),
});
if (touchIdReady) {
    session.fromPartition("persist:browser").on("select-webauthn-account", (_event, details, callback) => {
        void handleWebAuthnAccountSelection(details, callback, chooseWebAuthnAccount, (m, e) => console.warn(m, e));
    });
}
```

`chooseWebAuthnAccount(relyingPartyId, labels)` is a small function in `main.ts`. It calls `dialog.showMessageBox` with the main window as parent when there is one (`type: "question"`, message "Choose a passkey", detail `Sign in to ${relyingPartyId} as:`, `buttons: [...labels, "Cancel"]`, `cancelId: labels.length`, `defaultId: 0`, `noLink: true`). It returns the clicked index, or `null` for Cancel.

Then run typecheck, oxlint and `bun test` in `electron`. Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add electron/src/webauthn.ts electron/src/webauthn.test.ts electron/src/main.ts
git commit -m "feat(browser): enable Touch ID passkeys in browser tabs"
```

- [ ] **Step 7: Signed-build check**

Run `bun run package`. Start the binary with the packaged launch recipe (Facts) and open a tab on `https://example.com` through the API. Run the probe with `--uvpaa-only` (see its header). In this build a platform `create()` would put a real Touch ID dialog on the owner's screen, which steals focus, and a touch would leave a stray keychain item. So `create()` is left to the owner's hand check in Section 4. Expected:
- `uvpaa: true`. **This is the required automated result.**
- `create` is `skipped`.
- `app.log` has no WebAuthn warning from `configureTouchIdWebAuthn`.

Also run the unsigned dev app with the dev launch recipe (never `bun run dev:electron`). It starts cleanly and logs no WebAuthn error, because configure is skipped and no listener is registered.

If `uvpaa` is `false`, read the app log and the DevTools console for Electron's WebAuthn messages. Check whether the permission policy (`electron/src/browser-host/permission-policy.ts`) is being asked for something WebAuthn-related; add only that exact permission, with a test in `permission-policy.test.ts`. If it still doesn't work after that, stop and notify.

- [ ] **Step 8: Diff review, then hand off**

Run the chain's diff review against the Section 3 base and triage it. In Facts, record the probe output and the path of the signed package (`electron/release/mac-arm64/Taskflow.app`). **Next step** → "Section 4".
