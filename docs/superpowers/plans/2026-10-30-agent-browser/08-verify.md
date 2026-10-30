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
   - On A's page session (a raw `CDPSession` from Playwright), `Tracing.start` and `ServiceWorker.stopAllWorkers` fail with `Not allowed by Taskflow: <method>`.
   - Named popups: B's page runs `window.open(url, "oauth")`, then A's page runs `window.open(otherUrl, "oauth")`. A's call opens nothing (it returns `null`), and B's popup keeps its URL. A second `window.open(..., "oauth")` from B reuses B's popup.
3. **Background.** While a client is clicking and taking screenshots in a loop on A:
   - the user is on task B;
   - the user is then on A's other tabs;
   - the main window is closed to the tray (macOS).

   Screenshots are non-blank and the interval counter advances in all three. Reopening the window shows the tab live, without a reload.

   Also disconnect the client and connect a new one while the tab is hidden: a click still works (the spike found that a view in no window stops painting after a reconnect; the park window must prevent it). Closing the main window still hides the dock icon on macOS, and on Windows/Linux (if available) still quits the app, although the park window exists.
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
10b. **Renderer reload.** With A visible, View → Reload, then View → Force Reload. Each time the rebuilt UI is not covered by the page (whatever tab it opens on), A is still loaded (`browser list`), an open client keeps working, and selecting A shows it live.
11. **Split view.** A browser tab in the right pane and another in the left both render and follow resizes.
12. **Fallback.** In the web UI (browser dev renderer), New Tab → Browser opens today's iframe tab, and the CLI's `open` against a backend with no host returns the exact error. Remote-machine workspaces: not runnable without a second machine; note it as not run.
13. **Clients.** Repeat item 1 with Playwright Python and Puppeteer. Puppeteer reaches the page through its tab target (`puppeteer.connect({ browserURL: endpoint })`, then `browser.pages()` lists exactly A); `browser.newPage()` opens a child tab in A.
13b. **Input stays in its window (t3code amendment).** t3code needed guards so keys typed into a page didn't land in the app window (`apps/desktop/src/preview/GuestInput.ts`). Check our model needs none:
    - with focus in a Taskflow text field (task notes, the markdown editor) and A hidden, the client runs `page.fill` and `page.keyboard.type` on A. A gets the text and the Taskflow field is unchanged. Repeat with A visible and focus in a Taskflow terminal;
    - the client types into an input inside a cross-origin iframe on A (a local page on one port embedding a page on another). The iframe gets the text;
    - `page.reload()` from the client and Reload from the toolbar both work, with A hidden and visible.
13c. **Concurrent capture (t3code amendment).** While A is shown, the client takes 5 screenshots at once (`Promise.all`) while the user opens and closes a dropdown over the pane (freeze) 10 times. Then repeat with a navigation started mid-capture, and with A2 closed mid-capture. Expected: main and renderer stay up, each screenshot succeeds or rejects, a failed freeze leaves the placeholder blank and the page goes live when the overlay closes. **If main or a renderer crashes:** stop the chain and notify the user. Serializing the agents' `Page.captureScreenshot` with the app's `capturePage` crosses processes and needs a design decision.
13d. **Session policy (t3code amendment).** A local test page requests geolocation, notifications, the camera and `navigator.clipboard.readText()`: each is denied with no prompt. `navigator.clipboard.writeText()` works. Clicking a `mailto:` link and a `vscode://` link opens nothing, and the main log records the refusal.
14. **Agent prompt.** A fresh Claude session's `--append-system-prompt` contains the exact nudge, and `taskflow-cli browser --help`/usage matches the plan.

15. **User agent (t3code amendment).** t3code keeps Electron's native UA because rewriting it failed Cloudflare Turnstile's integrity checks (`apps/desktop/src/preview/BrowserSession.ts`). Load a Turnstile demo page and a Google sign-in page in a hosted tab with the stripped UA, then again with `setUserAgent` commented out locally. If only the native UA passes, apply Section 5's fallback (drop `setUserAgent`) as a `fix(electron): …` commit. Record the results either way.

## Steps

- [ ] **Step 1:** Run the checklist. Fix defects in the owning section's files, with a test where a unit test can catch the defect. Commit each fix as `fix(<area>): …`.
- [ ] **Step 2:** Final review: run `codex exec` with `-m gpt-6.1-sol -s read-only` (read the `codex-review` skill first) over the range `<base>..HEAD`, where `<base>` is the base recorded by Section 2 in `handoff.md`. Save the output to `reviews/final.md`. Triage it in `reviews/final-triage.md`, fix confirmed findings, and record them.
- [ ] **Step 3:** Update `handoff.md` (checklist results and "Deviations from the spec"). Add implementation amendments to the spec. Commit `docs: agent browser verification and close-out`.
