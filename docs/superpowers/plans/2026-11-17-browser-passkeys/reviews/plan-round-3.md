# Plan review round 3

**Verdict: Clear with non-blocking follow-ups.**

No blocker or major finding. Two minor execution-recipe issues and one wording nit remain. Read-only review completed; no files changed or apps launched. `bun run lint` passed.

## R3-1 — Minor: the process guard misses the documented dev launch

**Location:** [handoff.md:32](/Users/kuindji/Projects/taskflow/docs/superpowers/plans/2026-11-17-browser-passkeys/handoff.md:32), launch setup and stop checks. Concerns [main.ts:86](/Users/kuindji/Projects/taskflow/electron/src/main.ts:86).

The guard requires this dev-process suffix:

```text
node_modules/.*Electron \.
```

The corrected repo-root launch passes `electron` as the app-directory argument:

```sh
electron/node_modules/.bin/electron electron
```

I checked the regex against both command forms. It matches `…/MacOS/Electron .` but misses `…/MacOS/Electron electron`.

Consequently, the launch and teardown checks can overlook a running dev instance. This matters because dev mode deliberately skips the single-instance lock. The sandbox still limits the consequence, so this is non-blocking.

**Suggested fix:** Match the Electron executable independently of its app-directory argument, then inspect PID and sandbox ownership. Apply the same correction to both guard occurrences.

## R3-2 — Minor: sandbox CLI instructions remove credentials without replacing them

**Location:** [handoff.md:33](/Users/kuindji/Projects/taskflow/docs/superpowers/plans/2026-11-17-browser-passkeys/handoff.md:33), environment-scrubbing instructions. Concerns [taskflow-cli-bin.ts:11](/Users/kuindji/Projects/taskflow/packages/backend/src/services/taskflow-cli-bin.ts:11).

The recipe instructs agents to apply the scrub prefix to sandbox `taskflow-cli` calls. That prefix removes `TASKFLOW_API_URL` and `TASKFLOW_API_TOKEN`, but no sandbox replacement is specified.

The CLI immediately exits when the URL is absent:

```ts
if (!API_URL) {
    process.stderr.write("Error: TASKFLOW_API_URL is not set\n");
    process.exit(1);
}
```

I reproduced that failure using the documented scrub prefix; no request reached a backend.

The sections’ explicit HTTP and WS smoke paths remain executable, so this does not block their verification. It does leave the advertised sandbox CLI recipe incomplete.

**Suggested fix:** After scrubbing, explicitly assign `TASKFLOW_API_URL="http://127.0.0.1:$PORT"` and `TASKFLOW_API_TOKEN="$TOKEN"` for sandbox CLI calls. Supply sandbox project/session identifiers where the command requires them. Keep chain-control CLI calls in their original context.

## R3-3 — Nit: name the actual successful updater state

**Location:** [02-electron-upgrade.md:89](/Users/kuindji/Projects/taskflow/docs/superpowers/plans/2026-11-17-browser-passkeys/02-electron-upgrade.md:89), Step 11. Concerns [update-machine.ts:63](/Users/kuindji/Projects/taskflow/electron/src/update-machine.ts:63).

The acceptance wording says “a no-update/available state.” `no-update` is an event; the resulting status is `idle`.

A pure reducer check produced:

```json
{"status":"idle","checkedAt":"2026-11-17T10:00:00Z","message":null}
```

**Suggested fix:** Specify `status === "idle"` with a populated `checkedAt` for a completed no-update check, or `status === "available"` for an available update. Retain the existing error-log check.

## Round-2 follow-up

| Finding | Result |
|---|---|
| R2-1 | Fixed. Section 4 distinguishes draft upload from owner publication, handles an existing published version, checks assets, and requires `isDraft: false` before accepting release confirmation. Installed publisher 26.8.1 matches those assumptions. |
| R2-2 | Fixed. The automated gate requires the exact unique body in `Notification.getHistory()`. An unreachable inspector defers verification to an owner-visible notification check. Generic logs cannot pass the gate. |
| R2-3 | Fixed consistently in the spec, Section 3 and Section 4: touch first, then choose, including chooser cancellation. |
| R2-4 | Repo-root paths, per-call setup, port/token derivation and the chain-control scrubbing exception are fixed. R3-1 and R3-2 identify remaining recipe details. |
| R2-5 | Fixed. Session B initializes `S`, replaces the no-profile assertions, and provides the profile-backed checklist reused by later sections. |
| C2-1 | Fixed. The owner removes the sandbox-created passkey from the real site and repeats the check in the installed app after updating. |
| C2-2 | Fixed. The probe parses `--uvpaa-only`, returns before `create()`, and Section 3 explicitly requires that mode. |

The touch-before-choose ordering matches round 2’s recorded pinned-Chromium evidence. I could not independently re-fetch that exact Chromium source this round; no physical ceremony was performed.

## Checks found correct

- `configureWebAuthn`, its options and the named TypeScript interfaces match the retained Electron 45 declaration snapshot and tagged documentation. The proposed `whenReady()` placement precedes browser requests. [Electron API source](https://github.com/electron/electron/blob/v45.3.3/shell/browser/api/electron_api_app.cc#L1616-L1675)
- The listener targets the actual `persist:browser` session. Single-account selection, chooser cancellation and exactly-once callback requirements remain covered. [Session documentation](https://github.com/electron/electron/blob/v45.3.3/docs/api/session.md#event-select-webauthn-account)
- Apple requires profile authorization for `keychain-access-groups`. Installed builder 26.8.1 passes the profile for Developer ID signing and separates main from inherited entitlements. No-profile survival is correctly treated as evidence only. [Apple TN3125](https://developer.apple.com/documentation/technotes/tn3125-inside-code-signing-provisioning-profiles#Entitlements-on-macOS)
- The development binary and packaging distribution are separate download paths. `bun install` alone does not establish offline readiness. [Electron download change](https://github.com/electron/electron/blob/v45.3.3/docs/breaking-changes.md#behavior-changed-electron-no-longer-downloads-itself-via-postinstall-script)
- Round-1 fixes remain present: profile isolation before launch, abort-based probing, authenticated HTTP/WS requests, lint exclusion, separate dialog trackers, notarization gates and success-only close-out.
- I found no additional concrete removed-API conflict in the inspected preloads, views, navigation, popup handling, permission policy or CDP integration. Portal changes, account operations and release publication remain owner-gated.