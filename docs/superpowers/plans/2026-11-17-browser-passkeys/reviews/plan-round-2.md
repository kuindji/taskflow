# Plan review round 2

**Verdict: Changes required.**

Read-only review completed against the requested documents, current Electron sources and release scripts, installed electron-builder 26.8.1 / osx-sign 1.3.3, and upstream sources. No files changed, apps launched, or signing/publishing operations performed.

`bun run lint` passed.

## R2-1 — Major: the release command creates a draft, leaving auto-update verification blocked

**Location:** [04-release.md, Step 5](/Users/kuindji/Projects/taskflow/docs/superpowers/plans/2026-11-17-browser-passkeys/04-release.md:41). Concerns [electron/package.json:20](/Users/kuindji/Projects/taskflow/electron/package.json:20) and its publish configuration at line 41.

The plan says `bun run release:mac-all` publishes the release, then directs the owner to auto-update. Its underlying command is:

```sh
electron-builder --mac --x64 --arm64 --publish always
```

There is no `releaseType` configuration. The installed GitHub publisher defaults to `"draft"` unless explicitly overridden. `--publish always` enables uploading; it does not select a public release.

**Reproduced without network access:** constructing the installed publisher with the script’s options and a dummy token returned:

```json
{"releaseType":"draft"}
```

Evidence: installed [gitHubPublisher.js:52](/Users/kuindji/Projects/taskflow/node_modules/.bun/electron-publish@26.8.1/node_modules/electron-publish/out/gitHubPublisher.js:52), with draft creation at line 175. The installed updater discovers published releases through [GitHubProvider.js:48](/Users/kuindji/Projects/taskflow/node_modules/.bun/electron-updater@6.8.3/node_modules/electron-updater/out/providers/GitHubProvider.js:48).

**Suggested fix:** Within the owner-approved publishing session, upload the draft, verify both architectures and update metadata, then explicitly publish it. Require verification that `v0.17.0` has `draft: false` and is discoverable by the updater before handing off Step 6. Handle an existing draft explicitly too.

**Confidence:** High; verified against installed implementation and reproduced locally.

## R2-2 — Major: notification verification can pass without delivery

**Location:** [02-electron-upgrade.md, Step 11](/Users/kuindji/Projects/taskflow/docs/superpowers/plans/2026-11-17-browser-passkeys/02-electron-upgrade.md:88). Concerns [main.ts:171](/Users/kuindji/Projects/taskflow/electron/src/main.ts:171) and [notification-poller.ts:138](/Users/kuindji/Projects/taskflow/electron/src/notification-poller.ts:138).

The fallback accepts this as notification evidence:

```sh
log show ... --predicate 'process == "usernoted" OR process == "NotificationCenter"' |
grep -i taskflow
```

A Taskflow-related log line does not establish that this smoke notification was delivered. Registration, authorization, suppression, or another running Taskflow instance can produce matching evidence. Absence of the new `failed` log also does not prove delivery.

This leaves R1-7’s positive notification gate incomplete.

**Suggested fix:** Send a unique smoke message and require evidence tied to that message and test process. Electron 45 provides main-process `Notification.getHistory()`, which reports delivered notifications still in Notification Center. Alternatively require an owner-confirmed visual check of the unique message. Generic matching logs should be diagnostic evidence only. [Electron notification documentation](https://github.com/electron/electron/blob/v45.3.3/docs/api/notification.md#notificationgethistory-macos)

## R2-3 — Major: the owner’s multi-account test expects the prompts in reverse order

**Location:** [04-release.md, Step 4, instruction 4](/Users/kuindji/Projects/taskflow/docs/superpowers/plans/2026-11-17-browser-passkeys/04-release.md:35), following Section 3’s account-selection design. Concerns the planned handler wired into [main.ts:233](/Users/kuindji/Projects/taskflow/electron/src/main.ts:233).

The owner is told:

> A "Choose a passkey" dialog should list both. Pick one and touch…

For a Touch ID assertion requiring user verification, Chromium prompts for Touch ID **before** generating the assertion responses. Only afterward does Chromium call the embedder’s account-selection handler.

In Electron 45.3.3’s pinned Chromium 156.0.8078.100:

- `GetAssertionOperation::Run()` calls `PromptTouchId`.
- Successful verification generates the responses.
- `AuthenticatorCommonImpl::OnSignResponse()` subsequently calls `SelectAccount`.

Sources: [Touch ID assertion operation](https://github.com/chromium/chromium/blob/156.0.8078.100/device/fido/mac/get_assertion_operation.mm#L66-L111), [account-selection dispatch](https://github.com/chromium/chromium/blob/156.0.8078.100/content/browser/webauth/authenticator_common_impl.cc#L2929-L2941).

A working implementation can therefore appear stuck while the owner waits for the chooser without first touching the sensor.

**Suggested fix:** Describe the actual sequence: click Authenticate, complete Touch ID when requested, then choose the account. Test chooser cancellation after that verification. Align the explanatory wording in Section 3 and the spec.

**Confidence:** High; checked against the exact pinned Chromium source. No physical ceremony was performed.

## R2-4 — Minor: the shared smoke recipe still contains executable and context inconsistencies

**Location:** [handoff.md, Facts](/Users/kuindji/Projects/taskflow/docs/superpowers/plans/2026-11-17-browser-passkeys/handoff.md:30); Section 2 Step 10; spec Part 1. Concerns [electron/package.json:9](/Users/kuindji/Projects/taskflow/electron/package.json:9), [main.ts:249](/Users/kuindji/Projects/taskflow/electron/src/main.ts:249), and [taskflow-cli-bin.ts:11](/Users/kuindji/Projects/taskflow/packages/backend/src/services/taskflow-cli-bin.ts:11).

Three details remain:

- The dev recipe says to run from `electron/` using `electron/node_modules/.bin/electron .`. From that directory, the existing executable is `./node_modules/.bin/electron`. The documented `bunx electron .` alternative is valid.
- The recipe uses `$PORT` but supplies only a grep displaying the port, without assigning or validating it. Its “one Bash call each” instruction also needs explicit restoration of `$S`, token and endpoint between calls.
- “Prefix every … CLI call” with the scrub command conflicts with chain logging, notifications and session management. Those commands require the real controlling Taskflow context; removing `TASKFLOW_API_URL` makes the CLI exit immediately.

Additionally, [spec line 135](/Users/kuindji/Projects/taskflow/docs/superpowers/specs/2026-11-17-browser-passkeys-design.md:135) still names `bun run dev:electron` as a required workflow although the implementation plan forbids it and leaves its bug unfixed.

**Suggested fix:** Supply complete shell blocks with one stated working directory, explicit variable initialization, and validated responses. Limit environment scrubbing to sandbox smoke operations. Keep chain-control CLI calls in their original context, and update the spec to name the explicit sandboxed dev launch.

## R2-5 — Minor: Session B repeats assertions that require the profile to be absent

**Location:** [01-preflight.md, Steps 9–11](/Users/kuindji/Projects/taskflow/docs/superpowers/plans/2026-11-17-browser-passkeys/01-preflight.md:128), especially line 152; reused by Section 2 Step 11. Concerns [electron/package.json:50](/Users/kuindji/Projects/taskflow/electron/package.json:50).

After configuring the embedded profile, Step 11 says:

> Rerun Steps 5–6 and check, in addition…

But Step 6 requires that **no** `Contents/embedded.provisionprofile` exists. Step 11 simultaneously requires that the embedded file matches the supplied profile. These assertions cannot both pass.

Session B also uses `$S/profile.plist` before establishing `$S` in that fresh session.

**Suggested fix:** Give Session B its own scratch initialization. Reuse the build and codesign commands, explicitly replacing the no-profile expectations with the profile-backed assertions. Have later sections reference that unambiguous checklist.

## Round-1 follow-up

| Item | Result |
|---|---|
| R1-1 | Handler, single-account selection, chooser and cancellation tests are present. Owner-check ordering needs R2-3. |
| R1-2 | Dev-only override is specified before `ready`, preserving the default branch profile otherwise. Runtime isolation remains an implementation check. |
| R1-3 | Probe now aborts at 20 seconds and clears its timer. Pending creation is no longer treated as failure. |
| R1-4 | Profile-backed path, identifiers, authorization checks, certificate matching and owner gate are present. Checklist contradiction remains in R2-5. |
| R1-5 | HTTP bearer authentication, WS subprotocol authentication and notification context headers match the code. Recipe corrections remain in R2-4. |
| R1-6 | Probe moved under the existing `spike/` lint exclusion. Repository lint passed. |
| R1-7 | Real-site success, notarization, updater initialization and successful installed-app confirmation are required. Notification evidence remains insufficient under R2-2. |
| R1-8 | Probe commands now use repository-root or absolute paths. |
| Type-name note | `ConfigureWebAuthnOptions`, `SelectWebauthnAccountDetails` and `WebAuthnAccount` match the retained downloaded declaration snapshot and tagged API documentation. |
| C1-1 | Separate trackers are specified for all three open dialogs. |
| C1-2 | Sections avoid the unsafe dev script; the remaining spec/recipe inconsistencies are covered by R2-4. |

## Checks found correct

- `app.configureWebAuthn({ touchID: { keychainAccessGroup, promptReason } })` exists on macOS. Calling it inside `whenReady()`, before browser requests, is suitable. The `$1` substitution matches the implementation. [Electron source](https://github.com/electron/electron/blob/v45.3.3/shell/browser/api/electron_api_app.cc#L1616-L1675)
- The account listener targets the same `persist:browser` session used by browser views. Existing permission-handler installation does not remove that listener. [Electron session documentation](https://github.com/electron/electron/blob/v45.3.3/docs/api/session.md#event-select-webauthn-account)
- Apple documents profile authorization for `keychain-access-groups` on macOS. The plan correctly treats no-profile survival as evidence rather than authorization proof. I did not establish whether this particular incomplete signature would be killed at launch. [Apple TN3125](https://developer.apple.com/documentation/technotes/tn3125-inside-code-signing-provisioning-profiles#Entitlements-on-macOS)
- Installed builder 26.8.1 passes `mac.provisioningProfile` for Darwin signing and selects main versus inherited entitlements separately. Installed osx-sign skips automatic identifier entitlements without App Sandbox.
- The download distinction is correct: development Electron downloads on demand, while builder obtains its packaging distribution separately. Offline readiness requires both paths to be populated; `bun install` alone is insufficient. [Electron download change](https://github.com/electron/electron/blob/v45.3.3/docs/breaking-changes.md#behavior-changed-electron-no-longer-downloads-itself-via-postinstall-script)
- I found no additional concrete removed-API defect in the inspected preloads, browser views, navigation, popup handling, permission policy or CDP setup. Their planned runtime checks remain necessary.
- Portal changes, physical authentication and release approval remain owner-gated. Signing and notarization scripts match the cited repository configuration.

