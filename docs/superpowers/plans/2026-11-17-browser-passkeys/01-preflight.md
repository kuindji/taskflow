# Section 1 — Entitlement preflight (gate)

**Goal:** Prove that a Developer ID signed Taskflow with the `keychain-access-groups` entitlement launches. Do this on the current Electron 33 so the answer comes before the upgrade. Whether the entitlement needs an embedded provisioning profile is the open question from the spec.

**Files:**
- Modify: `electron/entitlements.mac.plist`: add the keychain group.
- Create: `electron/entitlements.inherit.mac.plist`: the existing four keys only.
- Modify: `electron/package.json`: `build.mac.entitlementsInherit` → `entitlements.inherit.mac.plist`.
- Possibly (branch B only): `electron/build/embedded.provisionprofile`, `build.mac.provisioningProfile`, and two more entitlement keys.

**Interfaces:** produces the entitlement files named in the plan index.

- [ ] **Step 1: Record the base**

`git rev-parse HEAD` → write it into `handoff.md` under "Final-review base" and in the Section 1 status row.

- [ ] **Step 2: Split the entitlements**

Create `electron/entitlements.inherit.mac.plist` with exactly the current four keys of `entitlements.mac.plist`: `allow-jit`, `allow-unsigned-executable-memory`, `allow-dyld-environment-variables`, `disable-library-validation`. Add this to `entitlements.mac.plist`:

```xml
<key>keychain-access-groups</key>
<array>
    <string>9SX8S58CA8.com.taskflow.app.webauthn</string>
</array>
```

Point `build.mac.entitlementsInherit` at `entitlements.inherit.mac.plist`.

- [ ] **Step 3: Build a signed package**

Run: `bun run package` (repo root; signs with the configured identity, skips notarization, `--dir` output).
Expected: `electron/release/mac-arm64/Taskflow.app` exists. The electron-builder log shows signing with `Ivan Kuindzhi (9SX8S58CA8)`.

- [ ] **Step 4: Check the signature**

Run:
```bash
APP=electron/release/mac-arm64/Taskflow.app
codesign --verify --deep --strict --verbose=2 "$APP"
codesign -d --entitlements - --xml "$APP" | plutil -p -
codesign -d --entitlements - --xml "$APP/Contents/Frameworks/Taskflow Helper (Renderer).app" | plutil -p -
```
Expected: verify passes. The main app shows `keychain-access-groups` = `9SX8S58CA8.com.taskflow.app.webauthn`, and the renderer helper does not.

- [ ] **Step 5: Launch it sandboxed and watch for AMFI**

Run the binary in the background with a scratch config dir. Use the command in `handoff.md` Facts. Wait 15 s, then check:
- the process is still alive (`pgrep -f "release/mac-arm64/Taskflow.app/Contents/MacOS/Taskflow"`);
- `app.log` has `Backend started on port`;
- `log show --last 2m --predicate 'process == "amfid" OR subsystem == "com.apple.amfi" OR eventMessage CONTAINS "Taskflow"' | grep -iE "entitlement|profile|denied|kill" | head`. There should be no restricted-entitlement rejection.

Then quit the app with `kill <pid>` (never via AppleScript `activate`).

**Pass (branch A):** alive, backend up, no AMFI rejection → go to Step 7.
**Fail:** the process dies at launch, or AMFI logs a missing-profile or restricted-entitlement error → Step 6.

- [ ] **Step 6 (branch B only): Provisioning profile, owner-gated**

Stop the chain and notify: `Passkeys: preflight needs a Developer ID provisioning profile`. Under **Next step** in `handoff.md`, write the owner instructions:
1. Apple Developer portal → Identifiers. Make sure an explicit App ID `com.taskflow.app` exists (team 9SX8S58CA8).
2. Profiles → "+" → Distribution → **Developer ID** → App ID `com.taskflow.app` → Developer ID certificate `Ivan Kuindzhi (9SX8S58CA8)` → download.
3. Save it as `electron/build/embedded.provisionprofile` and reply in a new session.

The next session (Next step "Section 1 branch B") then:
- sets `build.mac.provisioningProfile: "build/embedded.provisionprofile"`;
- adds `com.apple.application-identifier` = `9SX8S58CA8.com.taskflow.app` and `com.apple.developer.team-identifier` = `9SX8S58CA8` to `entitlements.mac.plist`;
- reruns Steps 3–5, and also checks that `Contents/embedded.provisionprofile` exists in the bundle.

If it still fails: gate failed. Stop and notify. Record the AMFI lines in `handoff.md`.

- [ ] **Step 7: Commit and record**

```bash
git add electron/entitlements.mac.plist electron/entitlements.inherit.mac.plist electron/package.json
# branch B also: electron/build/embedded.provisionprofile
git commit -m "build(mac): add webauthn keychain access group entitlement"
```

In `handoff.md` Facts, record: branch A or B, and the codesign/AMFI evidence in one line. Mark the gate as passed. **Next step** → "Implement Section 2".

Note: this proves launch only. Whether the keychain group actually works is proven in Section 3, because Electron 33 has no `configureWebAuthn`.
