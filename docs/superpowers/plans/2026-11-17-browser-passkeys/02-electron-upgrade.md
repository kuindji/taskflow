# Section 2 — Electron 33.4.11 → 45.3.3

**Goal:** Everything that works today still works on Electron 45.3.3: dev run, sessions and terminals, browser tabs with agent CDP, notifications on signed builds, dialogs, and the signed package.

**Files:**
- Modify: `electron/package.json` (pin `electron` to `45.3.3`; bump `electron-builder` / `@electron/notarize` / `electron-updater` only if 45 requires it), `bun.lock`
- Modify: `electron/src/main.ts:171-190` (notification `failed` listener)
- Create: `electron/src/dialog-last-path.ts`, `electron/src/dialog-last-path.test.ts`
- Modify: `electron/src/ipc-handlers.ts:212-245` (open dialogs use the tracker)
- Modify: whatever typecheck or the breaking-change audit flags (list each in `handoff.md` Deviations)

**Interfaces:**
- Produces: `createLastPathTracker()` (plan index), and Electron 45 types for Section 3.

- [ ] **Step 1: Record the base**: `git rev-parse HEAD` into the Section 2 status row.

- [ ] **Step 2: Bump and install**

Set `"electron": "45.3.3"` in `electron/package.json`, then `bun install` at the root.
Then make sure the binary exists. Since Electron 42 the binary is downloaded on the first run of `electron`'s bin (or with `install-electron`), not at install time. Run `cd electron && bunx electron --version`.
Expected: `v45.3.3`. If the download doesn't happen through bun, run the package's `install-electron` bin explicitly (`cd electron && bunx install-electron --no`). Record what worked in `handoff.md` Facts. The dev script (`electron .`) and electron-builder must both find their binary. electron-builder downloads its own Electron distribution for packaging, separately from the dev binary, so warming one doesn't prove the other: the Step 11 package build is the check for builder.

- [ ] **Step 3: Typecheck, lint, test**

Run at the root: `bun run typecheck`, `bun run lint`, and `cd electron && bun test`.
Expected: all pass. Fix every type error that comes from changed Electron typings at its source. Use no `as any` and no lint disables. Log each fix as a Deviation.

- [ ] **Step 4: Audit breaking changes 34–45**

Read https://github.com/electron/electron/blob/main/docs/breaking-changes.md, sections 34.0 through 45.0. For each entry, grep `electron/src` and `packages/ui/src` (the UI's preload-exposed API). In `reviews/breaking-changes-audit.md`, write one line per entry: `n/a` or `fixed: <how>`. The spec already lists the known hits. Don't skip the others.

- [ ] **Step 5: Write the failing tracker tests** (`electron/src/dialog-last-path.test.ts`)

```ts
test("no default path before anything is picked", () => {
    expect(createLastPathTracker().defaultPath()).toBeUndefined();
});
test("a picked directory becomes the default", () => {
    const t = createLastPathTracker();
    t.remember("/Users/me/Projects/app", "directory");
    expect(t.defaultPath()).toBe("/Users/me/Projects/app");
});
test("a picked file makes its parent directory the default", () => {
    const t = createLastPathTracker();
    t.remember("/Users/me/themes/dark.json", "file");
    expect(t.defaultPath()).toBe("/Users/me/themes");
});
```

Run `cd electron && bun test src/dialog-last-path.test.ts`. Expected: FAIL (module missing).

- [ ] **Step 6: Implement `createLastPathTracker()` in `electron/src/dialog-last-path.ts`**

In-memory only, using `path.dirname` for files. Run the test. Expected: PASS.

- [ ] **Step 7: Use it in `ipc-handlers.ts`**

Inside the handler-registration function, create one tracker per dialog, so that picking a theme file doesn't move where the project picker opens: `projectDirectoryPath`, `themeFilePath`, `filePath`. Pass `defaultPath: <its tracker>.defaultPath()` to each of the three `showOpenDialog` calls (`select-project-directory`, `select-theme-file`, `select-file`). On a non-cancelled result with a path, call `remember(result.filePaths[0], <kind>)`. Leave `showSaveDialog` as it is: it passes a Downloads-based `defaultPath` when there's a name, and Downloads is now the default otherwise, which suits saves.

- [ ] **Step 8: Notification failure logging**

In `main.ts`, before `desktopNotification.show()`, add `desktopNotification.on("failed", (_event, error) => console.warn("Desktop notification failed:", error))`. Use Electron 45's actual `failed` event signature from the typings.

- [ ] **Step 9: Commit**

```bash
git add electron/package.json bun.lock electron/src docs/superpowers/plans/2026-11-17-browser-passkeys/reviews/breaking-changes-audit.md
git commit -m "build(electron): upgrade to 45.3.3"
```
(Split into more commits if the audit fixes are separable.)

- [ ] **Step 10: Dev-run smoke (sandboxed)**

Run `bun run build` at the root. Then start the dev app with the **dev** launch recipe in `handoff.md` Facts. Never use `bun run dev:electron`: its `TASKFLOW_DEV=1` only applies to `cd`, so it runs against the owner's real profile and data. Check each of these and record pass/fail in `handoff.md`:
- `Backend started on port` in the log; no uncaught errors; `$S/electron-user-data/` is in use.
- Open a tab with the recipe's authenticated `POST /api/browser/tabs`. Then, from the repo root, run `bun docs/superpowers/plans/2026-11-17-browser-passkeys/spike/webauthn-probe.ts "$ENDPOINT" <scratch>/node_modules/playwright-core/index.mjs` (install per the probe header). Expected: `ua` contains `Electron/45.3.3`. `uvpaa` is still `false` here (nothing is configured yet).
- Playwright through the endpoint: `page.click` on a link navigates. On a test page, `window.open` creates a child that shows up in `GET /api/browser/tabs` with `parentId`.
- Main window renderer over the app debug port (`DevToolsActivePort`): `Runtime.evaluate("document.title")` works, and a screenshot by window id shows the UI.
- Over the recipe's WS connection: `project:add` a scratch git repo, `session:create` a `shell` session (`/bin/zsh`) in it, send `session:input` `echo smoke-ok\r`, and see `smoke-ok` in a `terminal:output` frame. Check the payload shapes in `packages/shared/src/types/ws.ts` first.
Then stop the app with the recipe's stop command.

- [ ] **Step 11: Signed-package smoke**

Run `bun run package`, then start the binary with the **packaged** launch recipe (Facts), adding `--inspect=127.0.0.1:0` after the binary path (main-process inspector, for the notification check; the build config sets no `electronFuses`, so the flag is allowed). Check:
- it launches;
- the profile-backed checks in Section 1 Step 11 ("Profile-backed checks") all still pass;
- a tab opens through the API.
- **Notification:** send the recipe's `POST /api/notifications` with a unique message, `passkeys smoke <unix time>`. Then read the delivered notifications in the main process: take the `Debugger listening on ws://…` URL from `app.log`, connect to it (a small Bun WebSocket script in `$S`), and send `Runtime.evaluate` with `includeCommandLineAPI: true`, `awaitPromise: true`, `returnByValue: true` and the expression `require("electron").Notification.getHistory().then((ns) => ns.map((n) => n.body))`. If `require` isn't defined there, use `process.mainModule.require` (main is CommonJS, `electron/build.ts:71`). **Pass:** within 15 s, the list contains the exact unique message and `app.log` has no `Desktop notification failed` line. **Fail:** a `failed` line, or the inspector works but the message never shows up. Then stop and notify, because the spec forbids shipping broken notifications. **Deferred:** if the inspector can't be reached at all, record "notification check deferred" in `handoff.md` Facts with why. Section 4 then adds it to the owner's pre-release check. Logs or window lists can be recorded as supporting evidence but never count as a pass.
- **Updater:** over the app debug port (`$S/electron-user-data/DevToolsActivePort`), evaluate `window.taskflow.getUpdateState()` in the main window. Pass if `status` settles to `idle` with a non-null `checkedAt` (no update; `electron/src/update-machine.ts:63`), or to `available`/`downloading`/`ready` (a newer release exists), and `app.log` has no `[updater] Error`. Record the state.

Stop the app with the recipe's stop command.

- [ ] **Step 12: Diff review, then hand off**

Run the chain's diff review against the Section 2 base and triage it. Then set **Next step** → "Implement Section 3".
