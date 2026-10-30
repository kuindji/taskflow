# Section 10: Desktop updater state machine

Read `handoff.md`, `design.md` §7 and `reviews/research-5-git-desktop.md`. Anchors were verified on 2026-10-30. Port the pure reducer behavior and relevant tests from `apps/desktop/src/updates/updateMachine.ts` and `apps/desktop/src/updates/updateMachine.test.ts` at t3code commit `32ecd717`.

**Files:**

- Create: `electron/src/update-machine.ts` and `electron/src/update-machine.test.ts`. No Electron imports.
- Create: `electron/src/update-controller.ts` and `electron/src/update-controller.test.ts`. Inject the updater, publication and exit-confirmation callbacks; no Electron runtime import in this module either.
- Modify: `electron/src/auto-updater.ts:6`, `:31`, `:37`, `:41`, `:54`, `:69`, `:81`, `:98`. Adapt Electron events to controller events and remove direct version-field assignments.
- Modify: `electron/src/app-menu.ts:4`, `:9`, `:24`, `:143`, `:363`; `electron/src/main.ts:36`, `:108`, `:115`, `:171`. Remove the menu's second copy of update state and wire one controller.
- Modify: `electron/src/ipc-handlers.ts:13`, `:196`; `electron/src/preload.ts:181`; `packages/ui/src/env.d.ts:62`. Route menu and renderer actions through the controller and provide a current-state IPC snapshot.
- Modify: `packages/shared/src/types/system.ts:15`. Add the shared state/event contracts below. The existing export in `packages/shared/src/index.ts:10` already exposes this module.
- Modify: `packages/ui/src/components/sidebar/UpdateDialog.tsx:14`, `:25`, `:74`, and `packages/ui/src/components/sidebar/TaskSidebar.tsx:64`, `:181`. Consume the shared type instead of casting string status to a renderer-local union.
- Create: `packages/ui/src/components/sidebar/UpdateDialog.test.tsx`. Follow `act`/`createRoot` from existing UI component tests; inject callbacks, not module replacements.
- Existing test style: `electron/src/notification-poller.test.ts:28` injects small fakes into a pure controller. Reuse that approach. There are currently no updater tests to extend.

**Interfaces:**

Consumes the existing `autoUpdater` singleton only in `auto-updater.ts`, `getMainWindow`, `buildAppMenu` and exit-confirmation state from main. Produces one authoritative `DesktopUpdateState` for the menu, IPC snapshot and renderer.

```ts
// Shared in types/system.ts. Taskflow keeps its existing ready/idle vocabulary.
interface DesktopUpdateState {
    status: "idle" | "checking" | "available" | "downloading" | "ready" | "installing" | "error";
    availableVersion: string | null;
    downloadedVersion: string | null;
    downloadPercent: number | null;
    checkedAt: string | null;
    message: string | null;
    errorContext: "check" | "download" | "install" | null;
    canRetry: boolean;
}
type DesktopUpdateEvent =
    | { type: "check-started"; checkedAt: string }
    | { type: "check-failed"; checkedAt: string; message: string }
    | { type: "update-available"; version: string; checkedAt: string }
    | { type: "no-update"; checkedAt: string }
    | { type: "download-started" }
    | { type: "download-progress"; percent: number }
    | { type: "download-completed"; version: string }
    | { type: "download-failed"; message: string }
    | { type: "install-started" }
    | { type: "install-failed"; message: string };

// update-machine.ts. Export only these two functions; helpers stay private.
function createInitialDesktopUpdateState(): DesktopUpdateState;
function reduceDesktopUpdateState(state: DesktopUpdateState, event: DesktopUpdateEvent): DesktopUpdateState;

// update-controller.ts. These types are exported because the Electron adapter consumes them.
interface UpdateController {
    getState(): DesktopUpdateState;
    check(manual?: boolean): Promise<void>;
    install(): void;
    retry(): Promise<void>;
    receive(event: DesktopUpdateEvent): void;
    receiveError(message: string): void; // library error, classified by active operation
}
interface UpdateControllerDeps {
    checkForUpdates(): Promise<unknown>;
    downloadUpdate(): Promise<unknown>;
    quitAndInstall(): void;
    publish(state: DesktopUpdateState): void;
    setExitConfirmed(value: boolean): void;
    now(): string;
    showNoUpdate(): void;
    showCheckFailure(message: string): void;
}
function createUpdateController(deps: UpdateControllerDeps): UpdateController;

// preload and env.d.ts
// Keep onUpdateStatus, now typed with DesktopUpdateState.
getUpdateState(): Promise<DesktopUpdateState>; // invoke "get-update-state"
onUpdateStatus(callback: (state: DesktopUpdateState) => void): () => void;
quitAndInstallUpdate(): void;                 // existing "quit-and-install-update"
retryUpdate(): void;                         // send "retry-update"

// UpdateDialog.tsx. TaskSidebar supplies the production callbacks.
interface UpdateDialogProps {
    updateStatus: DesktopUpdateState;
    dialogOpen: boolean;
    onDialogOpenChange(open: boolean): void;
    onInstall(): void;
    onRetry(): void;
}
```

Implementation detail: adapt t3code's reducer into one event-dispatch function using Taskflow's status names; omit unused channel, architecture, release-note and install-record fields.

## Behavior

### Pure state transitions

- Put `// Adapted from t3code (MIT, https://github.com/pingdotgg/t3code, 32ecd717): apps/desktop/src/updates/updateMachine.ts` above the reducer. The adapted tests cite `apps/desktop/src/updates/updateMachine.test.ts` in the same format. Why: the reducer preserves downloaded update metadata across recoverable errors.
- Initial state is `idle`, all nullable fields null and `canRetry: false`. The reducer is pure, never reads the clock, never calls Electron and never mutates its input.
- `check-started` sets `checking`, `checkedAt` from the event and clears message/errorContext/canRetry. Preserve a downloaded version and 100 percent progress. With no downloaded update, progress is null.
- `check-failed` without a download sets `error`, context `check`, the supplied message and `canRetry: true`. With a downloaded update, restore `ready`, retain its version and 100 percent progress, clear error fields and set `canRetry: true`, matching t3code. A failed manual check still calls `showCheckFailure`, so readiness and check failure are both represented correctly.
- `update-available` sets `availableVersion` and `checkedAt`. If it is the downloaded version, return to `ready`, keep downloadedVersion and 100 percent, and do not download it again. For a different version use `available`, clear stale downloadedVersion/progress/errors and set `canRetry: false`.
- `no-update` restores `ready` when downloadedVersion exists, with availableVersion equal to it and progress 100; otherwise return `idle`, clear versions/progress/errors and canRetry. Do not turn an already downloaded version into an empty state.
- `download-started` sets `downloading`, progress zero, clears errors and canRetry. `download-progress` updates progress. `download-completed` sets `ready`, both versions to the event version, progress 100 and canRetry true.
- `download-failed` retains availableVersion and any downloadedVersion, message and context `download`. With an available version it returns `available` and canRetry true; otherwise `error` and canRetry false. Retry re-downloads the known version rather than pretending it is already installed.
- `install-started` is accepted only with a downloaded version. It sets `installing`, clears errors, disables retry and retains both versions/progress. `install-failed` restores `ready`, keeps downloadedVersion, message, context `install` and canRetry true. Retry calls install again without another check or download.

### Controller and Electron wiring

- Keep `autoDownload = false` and existing automatic download after `update-available`. The controller dispatches `download-started` before calling downloadUpdate. Every check, download and install action goes through this controller, including app-menu and renderer actions; delete their direct `electron-updater` imports.
- `auto-updater.ts` translates `update-available`, `update-not-available`, `download-progress`, `update-downloaded` and `error`. The controller starts checks itself, so the library's `checking-for-update` event must not start a second operation or reset state again. Use the controller's action-start event as the single start transition.
- Change `initAutoUpdater` to accept `{ getMainWindow, buildAppMenu, setExitConfirmed }` and return `UpdateController`. Construct it before `initAppMenu` and `registerIpcHandlers` in main. Their deps take this controller rather than importing each other; the publication closure may call `buildAppMenu` after initialization. `setupAutoUpdater` registers the real listeners once, then calls `controller.check(false)`. `receiveError` classifies library errors using the private active phase.
- One operation at a time. Ignore check requests while checking/downloading/installing; ignore install when no download is ready or installation is already in progress. Keep a private active phase `check | download | install | null`, separate from visible status because a failed feed check can preserve `ready`.
- An operation has one private identity and one failure latch. The library can emit `error` and reject the same check/download promise. The first failure dispatches once; its matching catch does nothing. Keep terminal operation identity until its promise settles, so a late error/catch cannot corrupt a subsequent retry. A check that emits `update-available` may start a download before its check promise resolves; an old check settlement must not clear the new download phase.
- For an emitted error use the active operation's context; when no operation is active, log and retain state. `install()` dispatches before calling `quitAndInstall`, catches a synchronous throw, and treats an emitted error while installing as install failure. electron-updater's install returns void; do not claim a successful return proves installation. Do not add t3code's cross-restart install-record mechanism, which §7 does not select.
- Set exit confirmation immediately before `quitAndInstall`; restore it to false on install failure so a failed attempt does not bypass the next ordinary exit confirmation. Both menu and IPC use that path.
- `check(true)` owns a private manual-check flag until the check outcome, not until a download finishes. Preserve the current no-update dialog strings: title `No Updates`, message `You're up to date!`, detail `Taskflow <app version> is the latest version.` Manual check errors use title `Update Check Failed`, message `Could not check for updates.`, detail from the error. Download/install errors appear in shared state and the renderer; do not call them check failures.
- Publication sends the full state on existing `update-status` and rebuilds the menu. Menu derives its label from state: `Restart to Update to v<version>` for ready, `Downloading v<version>…`, `Checking for Updates…`, `Installing Update…`, or `Check for Updates…`. Failure retries use `Retry Update Download` and `Retry Update Installation`. Disable busy operations. Dispatch menu actions to check/install/retry as appropriate.
- Keep startup's packaged-only setup and current startup cache clearing at `main.ts:207` unchanged. Never clear cache as an error-recovery side effect. This section guarantees in-process preservation, not download persistence across app launches.
- IPC `get-update-state` returns a snapshot even when no window existed when the update arrived. The renderer subscribes first, then fetches the snapshot; an event received while that invoke was pending wins over the older snapshot. Drop callbacks after unmount. A renderer reload must show the ready update again.

### Renderer

- Reuse the shared state; remove the local `UpdateStatus` interface/cast. `TaskSidebar` starts at the same initial field values, then subscribes and requests a snapshot.
- Preserve checking/downloading indicators. Ready uses title `Update Available`, body `Taskflow v<version> is ready to install. The app will restart to apply the update.`, action `Restart Now`, and `Later`.
- Show distinct errors using title `Update Check Failed`, `Update Download Failed` or `Update Installation Failed`, followed by the supplied message. Check errorContext before rendering the ordinary ready/available presentation. Use `Retry` when canRetry is true. A failed install also says `Taskflow v<version> is still ready to install.` and routes Retry to the existing install action. During installation show `Installing update...` and disable both install/retry actions. Never offer install without downloadedVersion.
- Pass `onInstall` and `onRetry` as required `UpdateDialog` props from `TaskSidebar`; unit tests provide fakes. Do not reach through `window.taskflow` from the dialog itself.

## Steps

- [ ] **Step 1:** Adapt the four t3code reducer tests to `bun:test`, retaining their assertions under these names: `preserves an already-downloaded update while checking the feed`, `preserves available version on download failure for retry`, `transitions to ready and then preserves install retry state`, `clears stale available state when no update is available`. Add `failed check keeps a downloaded update ready`, `no-update keeps a downloaded update ready`, `a different available version clears stale downloaded readiness`, `install without a downloaded update is ignored`, `the reducer leaves its input unchanged`. Run `bun test electron/src/update-machine.test.ts`. Expected: FAIL.
- [ ] **Step 2:** Add the shared types and implement the pure reducer. Run the same command. Expected: PASS.
- [ ] **Step 3:** Write controller tests with an injected fake updater and deferred promises: `update available downloads once`, `a duplicate check is ignored while busy`, `a downloaded version is not downloaded again`, `an emitted error and matching rejection publish one failure`, `an old check settlement does not clear an active download`, `failed check publishes readiness and reports a manual check error`, `download retry does not call quitAndInstall`, `install retry uses the downloaded update without downloading again`, `synchronous and emitted install failures restore exit confirmation`, `install cannot run twice concurrently`, `errors outside an operation retain readiness`. Run `bun test electron/src/update-controller.test.ts`. Expected: FAIL.
- [ ] **Step 4:** Implement the controller, then run both Electron test files. Expected: PASS. Keep dependency interfaces structural, with no `as any` or `mock.module`.
- [ ] **Step 5:** Write `UpdateDialog.test.tsx` with real components and injected callbacks: `ready renders Restart Now with the downloaded version`, `check failure offers Retry`, `download failure says Update Download Failed`, `install failure retains the version and retries installation`, `installing disables duplicate actions`. Run `bun test packages/ui/src/components/sidebar/UpdateDialog.test.tsx`. Expected: FAIL.
- [ ] **Step 6:** Wire auto-updater events, menu, main, IPC, preload and renderer to the controller. Remove obsolete menu getters/setters and their exports/imports after checking all usages. Implement the dialog changes and snapshot subscription. Run Steps 3 and 5 commands. Expected: PASS.
- [ ] **Step 7:** Run `bun run typecheck`, `bun test electron/src`, `bun test packages/ui`, `bun test packages/shared`, and `bun run --cwd electron build`. Expected: PASS, including Electron's Node-only source typecheck. Lint changed TS/TSX files and run `bunx prettier --check <changed files>`; never format the repository.
- [ ] **Step 8:** Record a packaged-app manual check in handoff: download → failed feed check still offers restart; simulated install failure still offers Retry; menu and renderer agree; reload obtains current readiness; dev/unpackaged startup does not query the release feed. Use controlled fakes or a dedicated update feed for failure injection, not a real release/install. Check running apps before starting a separate instance and do not use another agent's instance. A Bun controller test is not packaged updater acceptance.
- [ ] **Step 9:** Run `git diff --check`, stage only this section's files, and commit `fix(electron): preserve downloaded updates with a pure update state machine`. No push or trailers.

## Open questions for the planner

None. This section ports the selected in-process reducer behavior; cross-restart install assurance is outside §7.
