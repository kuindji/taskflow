# Section 7: CLI, command doc, prompt nudge

**Files:**
- Modify: `packages/backend/src/services/taskflow-cli.sh` (the `browser)` case, `:287-332`). Use `api_request` (`:48`), so the `X-Taskflow-*` context headers are sent.
- Modify: `packages/backend/src/services/taskflow-cli-bin.ts` (`handleBrowser`, `:440-462`). Use `api()` plus `contextHeaders()`, the same as `devserver`.
- Modify: `packages/backend/src/services/taskflow-cli-browser-commands.md`.
- Modify: `packages/backend/src/services/internal-agent-skill.ts`. Append the prompt nudge (exact text in the plan index) to `PROMPT_BASE`, after the dev-server paragraph.
- Remove the old browser path, now that the CLI no longer uses it:
  - the `POST /api/tasks/:id/browser` and `/api/projects/:id/browser` routes (`task-routes.ts:317-336`, `project-routes.ts:28-48`);
  - the `MSG.BROWSER_OPEN` handler (`index.ts:425-429`);
  - `BROWSER_OPEN` in `packages/shared/src/constants.ts` and `BrowserOpenPayload` in `packages/shared/src/types/ws.ts`;
  - the UI listener `session-subscriptions.ts:163-181` (body and registration; Section 6 adds the replacement);
  - the tests that use them: `tests/api/routes.test.ts:~190-212` and the old-endpoint CLI tests (`taskflow-cli.test.ts:230` and the TS bin equivalents). Rewrite them against the new endpoints, or delete the ones the new tests cover.
- Modify the tests: the existing sh CLI test file (`taskflow-cli.test.ts`, fake curl that records headers via `readCapturedHeaders`), the TS bin test file, and the agent-skill test file.

## Command surface (both implementations, identical)

| Command | Request | Output |
|---|---|---|
| `browser open "<url>" [--label <text>] [--project \| --master]` | `POST /api/browser/tabs` `{url, label?, scope?}` (`--project` → `scope:"project"`, `--master` → `scope:"master"`) | the response JSON (`{tab, endpoint}`) |
| `browser "<url>" [--label] [--project]` | same as `open` (old form; the first argument isn't a subcommand name) | same |
| `browser list [--project \| --master]` | `GET /api/browser/tabs[?scope=…]` | the response JSON |
| `browser close <tabId>` | `DELETE /api/browser/tabs/<tabId>` | the response JSON |
| `browser` with nothing, or `open` with no URL | — | usage on stderr, exit 1 |

- A non-2xx response exits 1 through the existing helpers. Don't add a second path:
  - sh `api_request` (`taskflow-cli.sh:66-71`): the body (`{"error":"…"}`) on stdout, then `Error: <METHOD> <url> returned <code>` on stderr;
  - TS `api()` (`taskflow-cli-bin.ts:44-47`): `Error: <METHOD> <path> returned <status>: <body>` on stderr.

  Either way the agent sees the exact server message.
- Usage text: `Usage: taskflow-cli browser open <url> [--label <label>] [--project|--master] | list [--project|--master] | close <tabId>`.

## Command doc (`taskflow-cli-browser-commands.md`)

Replace the content with:
- the four commands, one line each, in the existing doc style;
- the output shape: `{"tab":{"id":…},"endpoint":"http://127.0.0.1:<port>/cdp/<id>"}`;
- a minimal Playwright example:

  ```js
  const browser = await chromium.connectOverCDP(endpoint);
  const page = browser.contexts()[0].pages()[0];
  ```

- the rules:
  - the endpoint shows only this tab and pages it opens;
  - `context.newPage()` opens another tab in the same task;
  - end with `browser.close()` only on Playwright's connected browser (it disconnects; Taskflow refuses to quit); prefer just exiting;
  - reconnect later with `browser list`;
  - the tab keeps running when the user looks elsewhere;
  - the user may also be using the tab.
- Puppeteer: `puppeteer.connect({ browserURL: endpoint })`.

## Steps

- [ ] **Step 1:** sh tests:
  - `browser open posts url and label to /api/browser/tabs with context headers`
  - `browser open --project sends scope project`
  - `browser open --master sends scope master`
  - `browser <url> (old form) posts like open`
  - `browser list GETs /api/browser/tabs`
  - `browser list --project adds ?scope=project`
  - `browser close <id> sends DELETE to /api/browser/tabs/<id>`
  - `browser with no args prints usage and exits 1`
  - `browser close without id prints usage and exits 1`
  - `browser open on a 503 exits 1 and the output carries the exact unavailable message`
- [ ] **Step 2:** The same tests for the TS bin.
- [ ] **Step 3:** Agent-skill test: `PROMPT_BASE contains the exact browser nudge`. Doc test, if the skill tests check the copied docs: the browser doc mentions `connectOverCDP`.
- [ ] **Step 4:** Run the three test files. Expected: FAIL.
- [ ] **Step 5:** Implement. Check sh syntax with `sh -n` and `dash -n` on the script.
- [ ] **Step 6:** Run the three test files and `cd packages/backend && bun test`. Expected: PASS.
- [ ] **Step 6b:** Run `bun run typecheck` (the shared removal touches the UI) and the UI test for `session-subscriptions`, if one exists (from the repo root, one file).
- [ ] **Step 7:** Commit `feat(cli): browser open/list/close with CDP endpoints and agent nudge`.
