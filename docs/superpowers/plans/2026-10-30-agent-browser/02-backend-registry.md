# Section 2: Shared types, store, host client, tab service

Read the plan index ("Cross-section interfaces") first. Every name below is defined there; this file adds behavior and tests.

**Files:**
- Create: `packages/shared/src/types/browser-tab.ts` (types from the index). Re-export it from the shared types index the way `dev-server.ts` is.
- Modify: `packages/shared/src/constants.ts`. Add `BROWSER_TABS_LIST`, `BROWSER_TAB_OPEN`, `BROWSER_TAB_CLOSE`. Leave `BROWSER_OPEN` in place; Section 3 removes it along with its users.
- Create: `packages/backend/src/services/browser-tab-store.ts` + `packages/backend/tests/services/browser-tab-store.test.ts`
- Create: `packages/backend/src/services/browser-tab-errors.ts` (the three error classes; Task 2.2)
- Create: `packages/backend/src/services/browser-host-client.ts` + `packages/backend/tests/services/browser-host-client.test.ts`
- Create: `packages/backend/src/services/browser-tab-service.ts` + `packages/backend/tests/services/browser-tab-service.test.ts`

**Interfaces:**
- Consumes: `WsEvent`, `MSG` (shared), the `DevServerStore` file pattern (`services/dev-server-store.ts`), `expectRejects` (`packages/backend/tests/expect-rejects.ts`).
- Produces: exactly the index's `BrowserTabStore`, `BrowserHostClient`, `createBrowserHostClient`, `BrowserTabService`, `createBrowserTabService`, `BrowserHostUnavailableError`, `BrowserTabInputError`, `BrowserTabNotFoundError`, `subscribeTabGone`.

## Task 2.1: Shared types and `BrowserTabStore`

- [ ] **Step 1:** Write the store tests in `browser-tab-store.test.ts` (temp dir per test):
  - `put then list returns the saved tab`
  - `put replaces a tab with the same id`
  - `remove returns false for an unknown id`
  - `a missing file lists as empty`
  - `a corrupt file lists as empty and the next put rewrites it` (same behavior as `DevServerStore`; copy its approach, don't invent another)
- [ ] **Step 2:** Run `cd packages/backend && bun test tests/services/browser-tab-store.test.ts`. Expected: FAIL (module not found).
- [ ] **Step 3:** Add the shared types and `MSG` entries. Implement `BrowserTabStore` with `DevServerStore`'s locking and atomic write pattern.
- [ ] **Step 4:** Run the store tests. Expected: PASS.
- [ ] **Step 5:** Commit `feat(backend): browser tab store and shared types`.

## Task 2.2: `BrowserHostClient`

- Uses `fetch` with `AbortSignal.timeout(10000)`.
- A non-2xx response, a network error, or a timeout all throw `BrowserHostUnavailableError` with the exact message `Browser not available on this machine: the Taskflow desktop app must be running here`.
- Create `browser-tab-errors.ts` first, with `BrowserHostUnavailableError`, `BrowserTabInputError` and `BrowserTabNotFoundError`. The client, the service, the routes and the gateway import them from there. Keep one home for the errors.

- [ ] **Step 1:** Tests, against a `Bun.serve` on port 0 in the test:
  - `ensure posts {tabId,url,parentId} to /tabs/ensure and returns targetId`
  - `close posts {tabId} to /tabs/close`
  - `a 500 throws BrowserHostUnavailableError`
  - `a refused connection throws BrowserHostUnavailableError` (use a closed port)
- [ ] **Step 2:** Run them. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run them. Expected: PASS.
- [ ] **Step 5:** Commit `feat(backend): browser host control client`.

## Task 2.3: `BrowserTabService`

Behavior, beyond the index signatures:

**Host state**
- `hostHeartbeat(hb)`:
  - stores `controlUrl`, `debugPort`, `appTargetIds` and `lastSeen = now()`;
  - reconciles the runtime state: a tab in `hb.loaded` gets `loaded: true` and its targetId mapping; every other tab gets `loaded: false` and loses its mapping;
  - takes each loaded tab's `url` and `title` from the heartbeat (re-saving saved tabs whose url changed), so navigation events lost while the backend was down are repaired;
  - a `hb.loaded` entry the registry doesn't know:
    - has a `parentId` the registry knows, or one that this same heartbeat adopts (process parents before children): it is adopted as an unsaved, loaded child under the parent's scope. This covers a backend restart and a heartbeat that overtakes `child-opened`. Its `label` is its URL's label, and `createdAt` is `now()`.
    - otherwise: `hostClient.close` (fire and forget, errors ignored);
  - re-arms the staleness timer through `deps.schedule(fn, 15000)`;
  - broadcasts only if something visible changed (availability, a `loaded` flag, an adopted tab, a url or title).
- `hostAvailable()`: there is a host and `now() - lastSeen <= 15000`.
- When the staleness timer fires and the host is stale:
  - every tab becomes `loaded: false`;
  - mappings are cleared;
  - `subscribeTabGone` listeners fire for each tab that was loaded;
  - it broadcasts.

**Opening and closing**
- `open`:
  - an empty or non-string `url` throws `BrowserTabInputError("Field 'url' is required and must be a non-empty string")`;
  - with no host available, it throws `BrowserHostUnavailableError`;
  - `label` defaults to the URL's hostname plus path, the same rule as `terminal-links.ts:70-77` (move that rule into `packages/shared` and reuse it from both places; no copy), and the raw URL when it doesn't parse (today's fallback);
  - it saves the record, then calls `hostClient.ensure({ tabId, url })`;
  - if `ensure` throws, it removes the record and rethrows.
- `openChild(parentId, url)`:
  - an unknown parent throws `BrowserTabNotFoundError("Browser tab not found")`;
  - the record gets the parent's scope and `parentId`;
  - it is **never saved**;
  - it calls `ensure({ tabId, url, parentId })`.
- `hostEvent`:
  - `child-opened` adds an unsaved, loaded record under the parent's scope. If the tab is already known (adopted by a heartbeat), it only updates the url and mapping. If the parent is unknown, it calls `hostClient.close(tabId)` instead.
  - `navigated` updates `url` and `title`, re-saves saved tabs, and broadcasts.
  - `closed` behaves like `close(tabId)` without calling the host.
- `close(id)`:
  - returns `false` for an unknown id;
  - otherwise closes the whole `familyOf(id)`, deepest first;
  - for each tab: if loaded and the host is available, `hostClient.close` (errors ignored); then `store.remove`, drop the mapping, fire `subscribeTabGone`;
  - broadcasts once.
- `closeForOwner`: `close` for every root tab whose scope matches. Child tabs go along with their parent.

**Loading and targets**
- `ensureLoaded(id)`:
  - an unknown id throws `BrowserTabNotFoundError`;
  - a loaded tab returns its mapping;
  - an unloaded child tab is closed, then `BrowserTabNotFoundError` is thrown, because popups aren't restorable;
  - otherwise it needs a host and calls `ensure({ tabId, url })`.
- `resolveTarget(targetId, { waitMs = 2000 })`:
  - a known mapping returns `{ tabId }`;
  - a targetId in `appTargetIds` returns `null`;
  - otherwise it waits until a mapping for that id appears (from `ensure`, `child-opened` or a heartbeat), or until `waitMs` passes and returns `null`.
- `init()`:
  - loads saved tabs (`loaded: false`, `agentConnections: 0`);
  - removes saved tabs whose `deps.isOwnerActive(scope)` is false;
  - broadcasts nothing.

`deps.schedule` defaults to `setTimeout`/`clearTimeout`; `deps.now` defaults to `Date.now`.

- [ ] **Step 1:** Write `browser-tab-service.test.ts` with fakes: an in-memory store wrapper over a temp file, a fake host client that records calls, a fake clock and a manual `schedule`. Tests:
  - `open without a host throws the exact unavailable message and saves nothing`
  - `open with a host saves, ensures and returns a loaded tab with a hostname label`
  - `open removes the record when ensure fails`
  - `open rejects an empty url with the exact message`
  - `heartbeat marks listed tabs loaded and others unloaded`
  - `heartbeat closes host views the registry does not know`
  - `heartbeat adopts an unknown child whose parent is known, unsaved, under the parent's scope`
  - `heartbeat adopts a grandchild listed before its parent`
  - `child-opened after a heartbeat already adopted the child does not duplicate it`
  - `heartbeat updates url and title of loaded tabs and persists saved ones`
  - `host goes stale after 15000 ms: tabs unload, tab-gone fires, hostAvailable false, one broadcast`
  - `child-opened adds an unsaved child with the parent's scope`
  - `child-opened with an unknown parent asks the host to close it`
  - `close closes descendants first and fires tab-gone for each`
  - `closeForOwner closes only that task's tabs and their children`
  - `ensureLoaded on an unloaded saved tab ensures it with its last url`
  - `ensureLoaded on an unloaded child closes it and throws not found`
  - `resolveTarget returns null at once for app targets`
  - `resolveTarget waits for a mapping that arrives within the wait`
  - `resolveTarget returns null after the wait for an unknown target`
  - `navigated updates url and title and persists saved tabs only`
  - `init drops saved tabs whose owner is not active`
  - `list filters by scope and carries hostAvailable`
- [ ] **Step 2:** Run `cd packages/backend && bun test tests/services/browser-tab-service.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement `browser-tab-service.ts`, and move the label rule into shared (update `terminal-links.ts` to use it).
- [ ] **Step 4:** Run the service tests, the store and client tests, and the UI test for `terminal-links` if one exists (from the repo root, one file). Expected: PASS.
- [ ] **Step 5:** Commit `feat(backend): browser tab service`.
