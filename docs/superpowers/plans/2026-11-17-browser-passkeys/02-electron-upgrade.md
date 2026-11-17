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
Expected: `v45.3.3`. If the download doesn't happen through bun, run the package's `install-electron` bin explicitly. Record what worked in `handoff.md` Facts. The dev script (`electron .`) and electron-builder must both find the binary.

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

Create one tracker inside the handler-registration function. Pass `defaultPath: tracker.defaultPath()` to the three `showOpenDialog` calls (`select-project-directory`, `select-theme-file`, `select-file`). On a non-cancelled result, call `remember(result.filePaths[0], <kind>)`. Leave `showSaveDialog` as it is: it already passes a Downloads-based `defaultPath`.

- [ ] **Step 8: Notification failure logging**

In `main.ts`, before `desktopNotification.show()`, add `desktopNotification.on("failed", (_event, error) => console.warn("Desktop notification failed:", error))`. Use Electron 45's actual `failed` event signature from the typings.

- [ ] **Step 9: Commit**

```bash
git add electron/package.json bun.lock electron/src docs/superpowers/plans/2026-11-17-browser-passkeys/reviews/breaking-changes-audit.md
git commit -m "build(electron): upgrade to 45.3.3"
```
(Split into more commits if the audit fixes are separable.)

- [ ] **Step 10: Dev-run smoke (sandboxed)**

Run `bun run build` at the root. Then in the background: `cd electron && TASKFLOW_DEV=1 TASKFLOW_CONFIG_DIR=<abs scratch> bunx electron . > <scratch>/dev.log 2>&1`. Check each of these and record pass/fail in `handoff.md`:
- `Backend started on port` in the log; no uncaught errors.
- Open a tab: `POST /api/browser/tabs` (see Facts). Then `bun probe/webauthn-probe.ts <endpoint> <playwright-core>`. Expected: `ua` contains `Electron/45.3.3`. `uvpaa` is still `false` here (nothing is configured yet).
- Playwright through the endpoint: `page.click` on a link navigates. On a test page, `window.open` creates a child that shows up in `GET /api/browser/tabs` with `parentId`.
- Main window renderer over the app debug port (`DevToolsActivePort`): `Runtime.evaluate("document.title")` works, and a screenshot by window id shows the UI.
- Create a session in the seeded project over the WS API and check the terminal produces output (see the dev-backend sandbox notes in the agent-browser handoff Facts).
Then kill the app.

- [ ] **Step 11: Signed-package smoke**

Run `bun run package`, then start the binary sandboxed (Facts). Check:
- it launches;
- the codesign entitlements are unchanged from Section 1;
- a tab opens through the API.

A desktop notification shows when a backend notification arrives. To trigger one, use the WS/HTTP API the notification poller reads (`packages/backend` notifications), or `taskflow-cli notify` pointed at the sandbox backend (`TASKFLOW_API_URL`). If a notification can't be triggered sandboxed, record "not verified" rather than guessing. Kill the app.

- [ ] **Step 12: Diff review, then hand off**

Run the chain's diff review against the Section 2 base and triage it. Then set **Next step** → "Implement Section 3".
