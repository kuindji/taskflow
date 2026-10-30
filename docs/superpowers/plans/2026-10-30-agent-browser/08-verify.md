# Section 8: Manual end-to-end verification and final review

Run against the real desktop app built from `main` (dev build is fine), on macOS. Use Playwright Node (`bunx`), Playwright Python (`uvx --with playwright`) and Puppeteer (`bunx`) clients written in the scratchpad, not in the repo. Record pass/fail per item in `handoff.md` ("Section 8 checklist").

## Checklist

1. **Open and drive.** From an agent session on task A, run `taskflow-cli browser open https://example.com --label "A"`. Check that:
   - a tab appears in task A;
   - Playwright Node connects to `endpoint` and sees exactly one page;
   - it navigates, fills and clicks on a test form, and screenshots.
2. **Isolation.**
   - Task B opens its own tab.
   - From A's endpoint: `getTargets`, `context.pages()` and an `attachToTarget` with B's targetId (read it from B's `/json/list`) all fail or show nothing of B's. Neither the Taskflow UI nor B is listed.
   - `browser.close()` from A's client leaves the app and both tabs alive.
3. **Background.** While a client is clicking and taking screenshots in a loop on A:
   - the user is on task B;
   - the user is then on A's other tabs;
   - the main window is closed to the tray (macOS).

   Screenshots are non-blank and the interval counter advances in all three. Reopening the window shows the tab live, without a reload.
4. **Shared use.** The user types into A's tab by hand while the agent reads the field. Both see the same page.
5. **Popups.** A `window.open` OAuth-like popup appears as a child tab in A and as a new page to the client; `window.opener` works. Closing A closes the popup.
6. **`newPage()`** from Playwright opens a child tab in A.
7. **Close from either side.** Use a second tab, A2, on task A; A itself stays open for item 8.
   - The user closes A2: the client's socket closes.
   - `taskflow-cli browser close <id>`: the UI tab disappears.
   - Archiving task B removes B's tabs.
8. **Host gone, backend alive.** Stop the Electron main process with `kill -STOP <main pid>`. The backend keeps running; only the heartbeats stop.
   - Within 15 s, `browser open` returns exactly `Browser not available on this machine: the Taskflow desktop app must be running here`.
   - A's open CDP connection closes.
   - Then `kill -CONT <main pid>`: within 5 s `hostAvailable` is true again and A's endpoint works.
9. **Restart.** Quit the app; the backend quits with it, so the CLI reports it can't reach the backend. Start the app.
   - `browser list` shows A with the same id and the same `/cdp/<id>` path (the port may differ), not loaded.
   - Connecting loads it at its last URL.
   - Popups from before the restart are gone.

   A backend restart while the app keeps running isn't reachable by hand: nothing restarts a killed backend (`electron/src/backend-manager.ts:108`). Section 2's heartbeat tests cover it. Record it as "unit tests only".
10. **Overlays.** With A visible:
    - opening a dialog, a dropdown over the pane, a context menu and a tooltip near the pane shows the overlay above a frozen page, and the page goes live when it closes;
    - a dropdown that doesn't reach the pane doesn't freeze it.
11. **Split view.** A browser tab in the right pane and another in the left both render and follow resizes.
12. **Fallback.** In the web UI (browser dev renderer), New Tab → Browser opens today's iframe tab, and the CLI's `open` against a backend with no host returns the exact error. Remote-machine workspaces: not runnable without a second machine; note it as not run.
13. **Clients.** Repeat item 1 with Playwright Python and Puppeteer.
14. **Agent prompt.** A fresh Claude session's `--append-system-prompt` contains the exact nudge, and `taskflow-cli browser --help`/usage matches the plan.

## Steps

- [ ] **Step 1:** Run the checklist. Fix defects in the owning section's files, with a test where a unit test can catch the defect. Commit each fix as `fix(<area>): …`.
- [ ] **Step 2:** Final review: run `codex exec` with `-m gpt-6.1-sol -s read-only` (read the `codex-review` skill first) over the range `<base>..HEAD`, where `<base>` is the base recorded by Section 2 in `handoff.md`. Save the output to `reviews/final.md`. Triage it in `reviews/final-triage.md`, fix confirmed findings, and record them.
- [ ] **Step 3:** Update `handoff.md` (checklist results and "Deviations from the spec"). Add implementation amendments to the spec. Commit `docs: agent browser verification and close-out`.
