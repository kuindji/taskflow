# Section 1 — Sandbox fix + entitlement preflight (gate)

**Goal:** Prove that a Developer ID signed Taskflow with the `keychain-access-groups` entitlement, authorized by an embedded Developer ID provisioning profile, launches. Do this on the current Electron 33 so the answer comes before the upgrade.

Apple TN3125 ("Entitlements on macOS") says `keychain-access-groups` is a restricted entitlement that must be authorized by a provisioning profile, so the profile is the expected path, not a fallback. The no-profile launch below is evidence only. Whatever it shows, the profile is still required.

First, fix the test sandbox: with `TASKFLOW_DEV=1`, Electron's `userData` is always `~/.config/taskflow-dev-<branch>` (`electron/src/main.ts:78-81`). `TASKFLOW_CONFIG_DIR` only moves backend data, so without the fix every "sandboxed" run shares one Electron profile (cookies, partitions, `DevToolsActivePort`).

This section runs in two sessions:
- **Session A** ("Implement Section 1"): Steps 1–8. It stops for the owner at Step 8 unless the profile is already in place.
- **Session B** ("Section 1 profile"): Steps 9–12.

**Files:**
- Create: `electron/src/dev-user-data.ts`, `electron/src/dev-user-data.test.ts`
- Modify: `electron/src/main.ts:78-81` (dev `userData` path)
- Modify: `electron/entitlements.mac.plist`: add the keychain group (Session A), then the application and team identifiers (Session B).
- Create: `electron/entitlements.inherit.mac.plist`: the existing four keys only.
- Modify: `electron/package.json`: `build.mac.entitlementsInherit` → `entitlements.inherit.mac.plist` (Session A), then `build.mac.provisioningProfile` (Session B).
- Add (Session B): `electron/build/embedded.provisionprofile` (from the owner; profiles aren't secret, every shipped app embeds one).

**Interfaces:** produces the entitlement files and `devUserDataPath` named in the plan index.

## Session A

- [ ] **Step 1: Record the base**

`git rev-parse HEAD` → write it into `handoff.md` under "Final-review base" and in the Section 1 status row.

- [ ] **Step 2: Failing tests for the dev `userData` path** (`electron/src/dev-user-data.test.ts`)

```ts
import { expect, test } from "bun:test";
import { devUserDataPath } from "./dev-user-data";

test("defaults to the per-branch dev profile", () => {
    expect(devUserDataPath({}, "/Users/me", "main")).toBe("/Users/me/.config/taskflow-dev-main");
});
test("a blank TASKFLOW_CONFIG_DIR is ignored", () => {
    expect(devUserDataPath({ TASKFLOW_CONFIG_DIR: "  " }, "/Users/me", "main")).toBe(
        "/Users/me/.config/taskflow-dev-main",
    );
});
test("lives inside TASKFLOW_CONFIG_DIR when set", () => {
    expect(devUserDataPath({ TASKFLOW_CONFIG_DIR: "/tmp/sbx" }, "/Users/me", "main")).toBe(
        "/tmp/sbx/electron-user-data",
    );
});
test("a relative TASKFLOW_CONFIG_DIR is refused", () => {
    expect(() => devUserDataPath({ TASKFLOW_CONFIG_DIR: "sbx" }, "/Users/me", "main")).toThrow(
        "TASKFLOW_CONFIG_DIR must be an absolute path",
    );
});
```

Run `cd electron && bun test src/dev-user-data.test.ts`. Expected: FAIL (module missing).

- [ ] **Step 3: Implement and wire it**

`electron/src/dev-user-data.ts`: `export function devUserDataPath(env: Readonly<Record<string, string | undefined>>, home: string, branch: string): string`. It trims the override, uses `path.isAbsolute`, and throws the same message the backend uses (`packages/backend/src/services/platform.ts:15`). In `main.ts`, inside the existing `if (process.env.TASKFLOW_DEV)` block, replace the `join(homedir(), ".config", ...)` argument with `devUserDataPath(process.env, homedir(), devBranch)`. Non-dev runs are untouched.

Run in `electron`: `bun run typecheck`, `bun test`; at the root: `bun run lint`. Expected: all pass. Then:

```bash
git add electron/src/dev-user-data.ts electron/src/dev-user-data.test.ts electron/src/main.ts
git commit -m "fix(electron): keep dev userData inside TASKFLOW_CONFIG_DIR"
```

- [ ] **Step 4: Split the entitlements**

Create `electron/entitlements.inherit.mac.plist` with exactly the current four keys of `entitlements.mac.plist`: `allow-jit`, `allow-unsigned-executable-memory`, `allow-dyld-environment-variables`, `disable-library-validation`. Add this to `entitlements.mac.plist`:

```xml
<key>keychain-access-groups</key>
<array>
    <string>9SX8S58CA8.com.taskflow.app.webauthn</string>
</array>
```

Point `build.mac.entitlementsInherit` at `entitlements.inherit.mac.plist`.

- [ ] **Step 5: Build a signed package (no profile)**

Make sure nothing gets embedded by accident: `ls electron/*.provisionprofile` must list nothing (osx-sign picks up any `*.provisionprofile` in its working directory).

Run: `bun run package` (repo root; signs with the configured identity, skips notarization, `--dir` output).
Expected: `electron/release/mac-arm64/Taskflow.app` exists. The electron-builder log shows signing with `Ivan Kuindzhi (9SX8S58CA8)`.

- [ ] **Step 6: Check the signature**

```bash
APP=electron/release/mac-arm64/Taskflow.app
codesign --verify --deep --strict --verbose=2 "$APP"
codesign -d --entitlements - --xml "$APP" | plutil -p -
codesign -d --entitlements - --xml "$APP/Contents/Frameworks/Taskflow Helper (Renderer).app" | plutil -p -
ls "$APP/Contents/embedded.provisionprofile"
```
Expected: verify passes. The main app shows `keychain-access-groups` = `9SX8S58CA8.com.taskflow.app.webauthn`, the renderer helper does not, and no `embedded.provisionprofile` exists.

- [ ] **Step 7: Launch sandboxed (evidence only)**

Note `stat -f %m ~/.config/taskflow-dev-main` first. Use the launch recipe in `handoff.md` Facts. Wait 15 s, then record:
- whether the process is still alive (`kill -0 "$(cat "$S/app.pid")"`);
- whether `app.log` has `Backend started on port`;
- that `$S/electron-user-data/` exists and `~/.config/taskflow-dev-main`'s mtime is unchanged (this proves the Step 3 fix);
- AMFI lines: `log show --last 3m --style compact --predicate 'process == "amfid" OR process == "taskgated" OR process == "kernel"' | grep -iE "taskflow|restricted|entitlement|profile" | head -20`.

Quit with the recipe's stop command (never via AppleScript `activate`). Write the result in one line in `handoff.md` Facts: "no-profile launch: killed/alive + the AMFI line". Either outcome is fine; it doesn't change the next step.

Then commit:
```bash
git add electron/entitlements.mac.plist electron/entitlements.inherit.mac.plist electron/package.json
git commit -m "build(mac): add webauthn keychain access group entitlement"
```

Note for later sessions (put it in Facts): until Session B lands, a signed build of `main` may not launch. Nothing gets released before Section 4.

- [ ] **Step 8: Provisioning profile (owner-gated)**

If `electron/build/embedded.provisionprofile` already exists, set **Next step** → "Section 1 profile" and continue the chain normally.

Otherwise, stop the chain and notify: `Passkeys: preflight needs a Developer ID provisioning profile`. Under **Next step** in `handoff.md`, write "Section 1 profile (waiting for the owner)" and these owner instructions:
1. Apple Developer portal → Certificates, Identifiers & Profiles → Identifiers. Make sure an explicit App ID `com.taskflow.app` exists for team 9SX8S58CA8. No extra capabilities are needed: the profile grants `9SX8S58CA8.*` keychain groups by default.
2. Profiles → "+" → Distribution → **Developer ID** → App ID `com.taskflow.app` → certificate "Developer ID Application: Ivan Kuindzhi (9SX8S58CA8)" → name it → Generate → Download.
3. Save it as `electron/build/embedded.provisionprofile`, then start a session with the usual chain prompt.

## Session B ("Section 1 profile")

- [ ] **Step 9: Inspect the profile before using it**

Pick this session's scratch dir `S` as in the launch recipe (Facts). Shell state doesn't persist, so set `S` at the top of every Bash call that uses it.

```bash
S=<absolute dir in this session's scratchpad>/run; mkdir -p "$S"
P=electron/build/embedded.provisionprofile
security cms -D -i "$P" > "$S/profile.plist"
plutil -extract Entitlements xml1 -o - "$S/profile.plist"
plutil -extract TeamIdentifier.0 raw "$S/profile.plist"
plutil -extract ExpirationDate raw "$S/profile.plist"
plutil -extract ProvisionsAllDevices raw "$S/profile.plist"
for i in 0 1 2 3; do plutil -extract DeveloperCertificates.$i raw "$S/profile.plist" 2>/dev/null | base64 -D | openssl x509 -inform der -noout -subject -fingerprint -sha1; done
security find-identity -v -p codesigning | grep "Developer ID Application: Ivan Kuindzhi (9SX8S58CA8)"
```
All of these must hold, or stop and notify with what's wrong:
- `Entitlements` has `com.apple.application-identifier` = `9SX8S58CA8.com.taskflow.app`, `com.apple.developer.team-identifier` = `9SX8S58CA8`, and `keychain-access-groups` contains `9SX8S58CA8.*` or `9SX8S58CA8.com.taskflow.app.webauthn`;
- `TeamIdentifier.0` = `9SX8S58CA8`; `ExpirationDate` is in the future; `ProvisionsAllDevices` = `true` (a Developer ID profile);
- one `DeveloperCertificates` SHA-1 equals the hash `find-identity` prints for the Developer ID Application identity.

- [ ] **Step 10: Embed it**

- `electron/package.json`: `build.mac.provisioningProfile` = `"build/embedded.provisionprofile"`.
- `electron/entitlements.mac.plist` (main app only, not the inherit plist): add `com.apple.application-identifier` = `9SX8S58CA8.com.taskflow.app` and `com.apple.developer.team-identifier` = `9SX8S58CA8`. osx-sign won't add them for us: its automatic entitlements are skipped for apps without `com.apple.security.app-sandbox`.

- [ ] **Step 11: Rebuild, verify, launch**

Rebuild with `bun run package` (repo root), as in Step 5. Step 6's "no `embedded.provisionprofile`" expectation no longer applies. Run these **profile-backed checks** instead (Section 2 Step 11 and Section 4 Step 3 reuse this list):

```bash
APP=electron/release/mac-arm64/Taskflow.app
codesign --verify --deep --strict --verbose=2 "$APP"
codesign -d --entitlements - --xml "$APP" | plutil -p -
codesign -d --entitlements - --xml "$APP/Contents/Frameworks/Taskflow Helper (Renderer).app" | plutil -p -
cmp "$APP/Contents/embedded.provisionprofile" electron/build/embedded.provisionprofile && echo profile-ok
codesign -dv "$APP" 2>&1 | grep TeamIdentifier
```
Expected:
- verify passes;
- the main app's entitlements are exactly the four keys + `keychain-access-groups` (`9SX8S58CA8.com.taskflow.app.webauthn`) + `com.apple.application-identifier` (`9SX8S58CA8.com.taskflow.app`) + `com.apple.developer.team-identifier` (`9SX8S58CA8`);
- the renderer helper has only the four keys;
- `profile-ok` is printed;
- `TeamIdentifier=9SX8S58CA8`.

Then launch sandboxed exactly as in Step 7. **Pass:** alive after 15 s, `Backend started on port` in the log, and no AMFI/taskgated rejection for Taskflow. **Fail:** gate failed. Record the AMFI lines in `handoff.md`, stop and notify `Passkeys: Section 1 gate failed`.

- [ ] **Step 12: Commit and record**

```bash
git add electron/package.json electron/entitlements.mac.plist electron/build/embedded.provisionprofile
git commit -m "build(mac): embed Developer ID provisioning profile"
```

In `handoff.md` Facts, record the codesign/AMFI evidence in one line and the profile's expiry date. Mark the gate as passed. **Next step** → "Implement Section 2".

Note: this proves launch only. Whether the keychain group actually works is proven in Sections 3–4, because Electron 33 has no `configureWebAuthn`.
