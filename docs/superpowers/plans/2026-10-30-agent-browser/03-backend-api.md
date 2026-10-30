# Section 3: HTTP and WS API, wiring, cleanup hooks

**Files:**
- Modify: `packages/backend/src/config.ts`. Add `config.browserTabsFile = join(BASE_DIR, \`browser-tabs-${instanceId}.json\`)` next to `devServersFile` (same reasoning: per instance, not in `buildDataPaths`).
- Create: `packages/backend/src/api/routes/browser-routes.ts` + `packages/backend/tests/api/browser-routes.test.ts`
- Create: `packages/backend/src/handlers/browser.ts` + `packages/backend/tests/handlers/browser.test.ts`
- Modify: `packages/backend/src/index.ts`:
  - construct the service after `devServerService` (`index.ts:369`) and `await service.init()`;
  - register the handlers and routes;
  - remove the `MSG.BROWSER_OPEN` handler (`index.ts:425-429`).
- Modify: `packages/backend/src/api/routes/task-routes.ts` and `project-routes.ts`. Delete the `POST /api/tasks/:id/browser` and `/api/projects/:id/browser` routes (`task-routes.ts:317-336`, `project-routes.ts:28-48`). The CLI moves to `/api/browser/tabs` in Section 7, and the CLI script is rewritten at every backend start, so no old client remains.
- Modify: the `ApiRouteDeps` type and `registerApiRoutes` (the `routes.ts` the dev-server work used). Add a required `browserTabService`.
- Modify: `packages/shared/src/constants.ts` and `packages/shared/src/types/ws.ts`. Remove `BROWSER_OPEN` and `BrowserOpenPayload`. The UI listener `session-subscriptions.ts:163-181` is removed in Section 6. Until then, delete only the listener's body and registration, so the UI still compiles; Section 6 adds the replacement.
- Modify: the cleanup call sites. Next to each `changeTracker?.untrack(...)` that follows an archive or delete, add `await browserTabService.closeForOwner({ taskId })`:
  - `handlers/task.ts:~150-158` (archive, including subtasks);
  - `api/routes/task-routes.ts:~356, ~374` (archive), `~439, ~455` (delete);
  - any other `archiveTask`, `deleteTask` or `deleteArchived` caller that grep finds outside `task-store.ts`;
  - project removal (the `PROJECT_REMOVED` broadcast site): `closeForOwner({ projectId })`, plus closing that project's task tabs.

  Pass `browserTabService` through the existing deps objects. Don't import it as a module singleton.

**Interfaces:**
- Consumes: Section 2's service and errors.
- Produces: the index's HTTP endpoints and WS handlers, and `config.browserTabsFile`.

## Behavior

**Scope resolution for `POST` and `GET /api/browser/tabs`.** Use the same header helpers as `dev-server-routes.ts`.
- If `scope` (body field for POST, query for GET) is given, use it:
  - `"task"` needs the task header;
  - `"project"` needs the project header;
  - `"master"` needs nothing;
  - a missing header gives 400 `Missing scope: no task, project or master context`.
- Otherwise, by Amendment 4: task header → task; project header → project; neither → master.

**Errors to status codes**
- `BrowserTabInputError` → 400.
- `BrowserTabNotFoundError` → 404.
- `BrowserHostUnavailableError` → 503.
- All of them return `{ error: message }`.

**`isOwnerActive`**
- task: `taskStore.getTask(id)` exists and isn't archived;
- project: the project exists;
- master: always true.

**WS handlers**
- `BROWSER_TABS_LIST` → `service.list()`.
- `BROWSER_TAB_OPEN` → `service.open(payload)`.
- `BROWSER_TAB_CLOSE` → `service.close(id)`, returning `{ success: true }`. An unknown id throws `Browser tab not found`.

## Steps

- [ ] **Step 1:** Write `browser-routes.test.ts` against a real `ApiRouter` with a fake service, the same style as the dev-server route tests:
  - `POST with a task header opens a task tab and returns 201 with endpoint built from Host`
  - `POST with only a project header opens a project tab`
  - `POST with no headers opens a master tab`
  - `POST scope=project without a project header returns 400 with the exact message`
  - `POST maps host-unavailable to 503 with the exact message`
  - `POST with an empty url returns 400 with the exact message`
  - `GET lists tabs of the resolved scope with an endpoint each and hostAvailable`
  - `DELETE unknown id returns 404 Browser tab not found`
  - `PUT /api/browser/host passes the heartbeat to the service`
  - `POST /api/browser/host/events passes the event to the service`
- [ ] **Step 2:** Write `handlers/browser.test.ts`: list, open and close round-trip through the test router (`tests/test-router.ts`), plus `close of an unknown id rejects with Browser tab not found`.
- [ ] **Step 3:** Run both. Expected: FAIL.
- [ ] **Step 4:** Implement the routes, the handlers, the config path and the `index.ts` wiring. Remove `BROWSER_OPEN` and the old routes.
- [ ] **Step 5:** Add the cleanup hooks. Add one test to the existing task archive and delete tests (handler and route, wherever they live) asserting that `closeForOwner` was called with the task id. Use the fake service through deps.
- [ ] **Step 6:** Run `bun run typecheck` and `cd packages/backend && bun test`. Expected: PASS (the platform flake rule applies).
- [ ] **Step 7:** Commit `feat(backend): browser tab API, wiring and cleanup on archive/delete`.
