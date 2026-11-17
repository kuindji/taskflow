# Plan review round 1

**Verdict: Changes required.**

Read-only review completed against all nine requested documents, repository sources, installed electron-builder 26.8.1 / osx-sign 1.3.3 sources, and upstream documentation. No files changed. I ran `bun run lint`; it failed with 22 errors in the probe.

## R1-1 — Major: discoverable passkey authentication needs an account-selection handler

**Location:** `03-touchid.md`, Steps 3–7; index, “Cross-section interfaces.” Concerns [electron-views.ts:47](/Users/kuindji/Projects/taskflow/electron/src/browser-host/electron-views.ts:47).

Section 3 only configures the authenticator. Neither the plan nor the existing browser-session setup registers `select-webauthn-account`.

Electron 45.3.3 explicitly documents that discoverable Touch ID assertions are cancelled without this listener, **even when only one credential matches**. Registration can therefore work while ordinary passkey sign-in fails with `NotAllowedError`. This is independent of implementing a Chrome-style picker. [Electron 45.3.3 session documentation](https://github.com/electron/electron/blob/v45.3.3/docs/api/session.md#event-select-webauthn-account)

**Suggested fix:** Register the handler on `session.fromPartition("persist:browser")` before browser requests begin. Select a sole matching credential and define the multiple-account behaviour explicitly. Add verification using `credentials.get()` without `allowCredentials`, including cancellation and multiple matches.

## R1-2 — Major: the prescribed scratch configuration does not isolate Electron’s profile

**Location:** Index, Global constraints; `handoff.md:28`; Section 1 Step 5; Section 2 Step 10; Section 4 Step 4. Concerns [main.ts:78](/Users/kuindji/Projects/taskflow/electron/src/main.ts:78) and [platform.ts:10](/Users/kuindji/Projects/taskflow/packages/backend/src/services/platform.ts:10).

The plan consistently calls this sandboxed:

```sh
TASKFLOW_DEV=1 TASKFLOW_CONFIG_DIR=<scratch> ...
```

`TASKFLOW_CONFIG_DIR` isolates backend storage. Electron instead executes:

```ts
app.setPath("userData", join(homedir(), ".config", `taskflow-dev-${devBranch}`));
```

Every planned run built on `main` therefore shares `~/.config/taskflow-dev-main`, including browser cookies, partition metadata, backend registry and `DevToolsActivePort`. The dev path also skips the single-instance lock. Different scratch directories do not prevent concurrent profile access or modification of the owner’s existing dev profile.

**Suggested fix:** Establish an explicit, verified Electron `userData` override before the first preflight launch, alongside the backend override. Check existing processes before launching and capture the launched PID directly. Update every launch recipe and handoff instruction.

## R1-3 — Major: the probe’s timeout criterion can reject a working authenticator

**Location:** `03-touchid.md`, Step 7; [webauthn-probe.ts:62](/Users/kuindji/Projects/taskflow/docs/superpowers/plans/2026-11-17-browser-passkeys/probe/webauthn-probe.ts:62).

The probe requests a 15-second timeout, races against 20 seconds, and Section 3 treats a pending result as failure.

Chromium clamps WebAuthn request timeouts. Its source uses a three-minute minimum outside virtual-authenticator testing. A working Touch ID request awaiting a finger can therefore legitimately remain pending after 20 seconds. The race also leaves that request running. [Chromium timeout adjustment](https://github.com/chromium/chromium/blob/main/content/browser/webauth/authenticator_common_impl.cc), [timeout constants](https://github.com/chromium/chromium/blob/main/device/fido/public/fido_constants.cc)

**Suggested fix:** Verify the effective timeout for the pinned Chromium build and allow its minimum plus margin. Alternatively, test cancellation separately with `AbortController`, while keeping successful physical authentication as the functional gate. Abort outstanding requests during cleanup.

**Confidence:** High that the current criterion is invalid. I inspected Chromium `main`; the exact Chromium 156 tag files could not be retrieved.

## R1-4 — Major: branch A cannot establish that the keychain entitlement is authorized

**Location:** Spec, “Constraints and known facts”; `01-preflight.md`, Steps 4–6. Concerns [entitlements.mac.plist:4](/Users/kuindji/Projects/taskflow/electron/entitlements.mac.plist:4) and [electron/package.json:50](/Users/kuindji/Projects/taskflow/electron/package.json:50).

The spec treats provisioning as an open question inferred from Electron’s omission. Apple explicitly identifies `keychain-access-groups` as a restricted macOS entitlement requiring profile authorization, including for Developer ID distribution. A successful signature and surviving process do not demonstrate that keychain operations are authorized. [Apple TN3125, “Entitlements on macOS”](https://developer.apple.com/documentation/technotes/tn3125-inside-code-signing-provisioning-profiles#Entitlements-on-macOS)

The installed signing implementation adds two relevant details:

- osx-sign can discover and embed a profile without `mac.provisioningProfile`, so branch A also needs to inspect what was actually embedded.
- Its entitlement automation returns early without `com.apple.security.app-sandbox`; this app cannot rely on that automation to supply application/team identifier entitlements.

**Suggested fix:** Make a matching Developer ID profile the documented supported path. Decode and inspect the embedded profile, verify its certificate, App ID, team, validity and authorization for the access group, and compare those with the signed entitlements. Retain the Electron 33 launch check as an additional gate.

**Confidence:** High on Apple’s documented requirement. I did not test whether this particular incomplete signature would be killed at launch or fail later during keychain access.

## R1-5 — Major: the smoke recipes omit authentication and notification context

**Location:** `handoff.md:28`; `02-electron-upgrade.md`, Steps 10–11; `03-touchid.md`, Step 7. Concerns [auth.ts:87](/Users/kuindji/Projects/taskflow/packages/backend/src/ws/auth.ts:87), [config.ts:115](/Users/kuindji/Projects/taskflow/packages/backend/src/config.ts:115), and [taskflow-cli-bin.ts:932](/Users/kuindji/Projects/taskflow/packages/backend/src/services/taskflow-cli-bin.ts:932).

The handoff supplies a port and POST body but no bearer token. These backend routes require authentication; an unauthenticated POST returns 401.

Changing only `TASKFLOW_API_URL` for `taskflow-cli notify` is also insufficient. The CLI needs the sandbox’s token and requires project/session IDs. An implementing agent may inherit credentials and IDs belonging to the real Taskflow session.

The referenced older browser handoff describes a previously seeded project, but provides no reusable authenticated seeding script.

**Suggested fix:** Supply one complete smoke procedure covering scratch creation, token loading, authenticated HTTP/WS requests, project/session creation and notification delivery. Scope or clear inherited Taskflow context variables explicitly. Never print tokens into reports.

## R1-6 — Major: the probe already breaks the required repository lint check

**Location:** Section 2 Step 3; [webauthn-probe.ts:18](/Users/kuindji/Projects/taskflow/docs/superpowers/plans/2026-11-17-browser-passkeys/probe/webauthn-probe.ts:18); [.oxlintrc.json:27](/Users/kuindji/Projects/taskflow/.oxlintrc.json:27).

**Reproduced:** `bun run lint` exits 1 with 22 errors, all in this probe.

The probe is outside the workspace TypeScript projects, and its static `typeof import("playwright-core")` cannot resolve the package installed in an unrelated scratch directory. The existing lint exclusion covers `**/spike/**`, not `**/probe/**`.

**Suggested fix:** Define how this development-only script is typed and checked before requiring repository lint to pass. Options include a dedicated scratch project or placing it under the established spike workflow. Keep Playwright outside product dependencies and avoid rule suppressions.

## R1-7 — Major: required acceptance checks can be skipped before publication or completion

**Location:** Section 2 Step 11; Section 4 Steps 3–7. Concerns [auto-updater.ts:57](/Users/kuindji/Projects/taskflow/electron/src/auto-updater.ts:57), [main.ts:171](/Users/kuindji/Projects/taskflow/electron/src/main.ts:171), and spec requirements at lines 42, 130 and 142.

Several requirements have no effective success gate:

- Signed notifications may be recorded as “not verified,” followed immediately by handoff.
- Section 2 never specifies how to verify updater initialization. Updating **from 0.16.1** later exercises the old app’s update path.
- The spec requires one owner-selected real site; Section 4 makes it optional.
- Section 4 Step 7 marks everything complete “once the owner reports the result,” without requiring success.
- The unsigned-notarization fallback still expects `spctl` to report `Notarized Developer ID`, which that fallback cannot establish.

**Suggested fix:** Require recorded positive results for signed notifications, updater initialization in Electron 45, real-site authentication, notarization and the installed-app check. Allow a non-notarized build for preliminary Touch ID testing, but keep notarization pending. Define failure/resume paths and close out only after successful owner confirmation.

## R1-8 — Minor: the short probe command uses the wrong working-directory-relative path

**Location:** `02-electron-upgrade.md`, Step 10, line 76.

The documented launch changes into `electron/`, then instructs:

```sh
bun probe/webauthn-probe.ts ...
```

There is no probe at that location. It resides under `docs/superpowers/plans/2026-11-17-browser-passkeys/probe/`.

**Suggested fix:** Use the full repository-relative path from an explicitly stated working directory, or an absolute path, consistently.

## Checks found correct

- The cited notification lines, three open-dialog handlers, build entry points, four existing entitlement keys, signing identity and notarization hook match the repository.
- Electron 45.3.3 exposes macOS `app.configureWebAuthn`, with the stated `touchID.keychainAccessGroup` and `$1` prompt substitution. Calling it inside `whenReady()`, before browser initialization, is a suitable choice. [Electron API source](https://github.com/electron/electron/blob/v45.3.3/shell/browser/api/electron_api_app.cc)
- electron-builder 26.8.1 supports `mac.provisioningProfile` for Darwin signing and applies the main/inherited entitlement files separately.
- The on-demand download description is broadly correct. Builder packaging independently downloads its target Electron distribution; warming the development binary alone does not establish offline packaging readiness. Cold/offline instructions should distinguish these paths. [Electron download change](https://github.com/electron/electron/blob/v45.3.3/docs/breaking-changes.md#behavior-changed-electron-no-longer-downloads-itself-via-postinstall-script)
- The preload sources do not use the removed Node shims. Browser views already use sandboxing and `navigationHistory`; I found no additional concrete removed-API defect in those paths.
- Portal changes, physical Touch ID checks and publication are explicitly owner-gated.

The published Electron 45 options type was not independently retrievable here, so `Electron.WebAuthnOptions` remains unverified. Using `Parameters<Electron.App["configureWebAuthn"]>[0]` would avoid guessing the exported type name.