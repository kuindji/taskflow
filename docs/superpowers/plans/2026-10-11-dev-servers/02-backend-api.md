# Section 2: Config path, HTTP routes, WS handlers, wiring

Read first: the plan index (especially "Cross-section interfaces"), `handoff.md`, and the spec sections "Storage", "API (HTTP, used by the CLI)" and "WebSocket (used by the desktop UI)". Section 1 has to be done. It provides:
- the shared types and `MSG.DEV_SERVER_LIST` / `MSG.DEV_SERVER_STOP`;
- `DevServerStore`;
- `createDevServerService`, `DevServerService` and `DevServerInputError`;
- the `StopProcess` type in `services/process-stopper.ts`.

This section adds no behaviour of its own beyond transport. Validation, the list broadcast and stopping all live in the service. Routes and handlers translate between HTTP or WS and the service, and nothing else.

The UI fetches the list itself when it attaches to a backend (`DEV_SERVER_LIST` request, Section 4). The spec's "sent on connect" is implemented by that fetch, so there's no `server.onConnect` push here.

Tasks are numbered 2.1 to 2.3.

### Task 2.1: `config.devServersFile`

**Files:**
- Modify: `packages/backend/src/config.ts`. Add `devServersFile` to the `config` object, directly after `instancePortFile` (around line 180).
- Create: `packages/backend/tests/config/dev-servers-file.test.ts`.

**Interfaces:**
- Produces: `config.devServersFile: string`, equal to `join(BASE_DIR, \`dev-servers-${instanceId}.json\`)`. It lives on `config`, not in `buildDataPaths`, so `updateConfigDataDir` never changes it.

- [ ] **Step 1: Write the failing test**

Create `packages/backend/tests/config/dev-servers-file.test.ts`:

```ts
import { expect, it } from "bun:test";
import { mkdtemp, rm } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { config, updateConfigDataDir } from "../../src/config";

it("keeps dev server records in the local config dir, one file per instance", () => {
    expect(config.devServersFile).toBe(
        join(config.baseDir, `dev-servers-${config.instanceId}.json`),
    );
});

it("doesn't move dev server records when the data dir changes", async () => {
    const before = config.devServersFile;
    const original = config.dataDir;
    const elsewhere = await mkdtemp(join(tmpdir(), "taskflow-data-"));
    try {
        updateConfigDataDir(elsewhere);
        expect(config.dataDir).toBe(elsewhere);
        expect(config.devServersFile).toBe(before);
    } finally {
        updateConfigDataDir(original);
        await rm(elsewhere, { recursive: true, force: true });
    }
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd packages/backend && bun test tests/config/dev-servers-file.test.ts`
Expected: FAIL. `config.devServersFile` is `undefined`, and typecheck would also reject the property.

- [ ] **Step 3: Add the path**

In `packages/backend/src/config.ts`, inside `export const config = { … }`, directly after the `instancePortFile` line:

```ts
    /**
     * Dev servers agents registered. Local and per instance, never in the data
     * dir: a PID only means something on the machine that issued it, and the
     * data dir can be moved or synced.
     */
    devServersFile: join(BASE_DIR, `dev-servers-${instanceId}.json`),
```

- [ ] **Step 4: Run it to verify it passes**

Run: `cd packages/backend && bun test tests/config/dev-servers-file.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/backend/src/config.ts packages/backend/tests/config/dev-servers-file.test.ts
git commit -m "feat(backend): local per-instance path for dev server records"
```

### Task 2.2: HTTP routes

**Files:**
- Create: `packages/backend/src/api/routes/dev-server-routes.ts`.
- Modify: `packages/backend/src/api/routes.ts`:
  - import the type and register the routes;
  - add `devServerService` to `ApiRouteDeps`.
- Modify: `packages/backend/tests/api/routes.test.ts`. Add a `devServerService` fake to `sharedTestDeps`, which every `registerApiRoutes` call in the file spreads, plus one test showing the routes are registered.
- Create: `packages/backend/tests/api/dev-server-routes.test.ts`.

**Interfaces:**
- Consumes (Section 1):
  - `DevServerService`, `DevServerInputError` and `createDevServerService` from `services/dev-server-service.ts`;
  - `DevServerStore` from `services/dev-server-store.ts`;
  - the `StopProcess` type from `services/process-stopper.ts`;
  - `DevServer` and `DevServerListResponse` from `@taskflow/shared`.
- Produces:
  - `registerDevServerRoutes({ apiRouter, devServerService })`, imported only by `api/routes.ts`;
  - `ApiRouteDeps.devServerService: DevServerService` (required).

  Route contract (from the plan index):

  | Route | Behaviour |
  |---|---|
  | `POST /api/dev-servers` | Requires `x-taskflow-project-id`. Takes `x-taskflow-task-id` and `x-taskflow-session-id` when present. Body `{ pid, label }`. Returns 201 with the `DevServer`; 400 `{ error }`. |
  | `GET /api/dev-servers` | Returns the caller's owner's records. With a task header, those with that `taskId`. Otherwise, those with the project header's `projectId` and no `taskId`. `?all=1` returns every record and needs no headers. Neither header nor `all` gives 400. |
  | `DELETE /api/dev-servers/:id` | 200 `{ success: true }`; 404 `{ error: "Dev server not found" }`. |
  | `DELETE /api/dev-servers?pid=<pid>` | Same as above. A missing or invalid `pid` gives 400 `{ error: "Field 'pid' must be a positive integer" }`. |

  `ApiRouter` matches on `url.pathname` only, so `/api/dev-servers` with `?pid=` or `?all=1` reaches the plain-path route, and `/api/dev-servers/<id>` reaches the `:id` route.

- [ ] **Step 1: Write the failing route tests**

Create `packages/backend/tests/api/dev-server-routes.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { MSG, type DevServer, type DevServerListResponse, type WsEvent } from "@taskflow/shared";
import { ApiRouter } from "../../src/api/router";
import { registerDevServerRoutes } from "../../src/api/routes/dev-server-routes";
import { DevServerStore } from "../../src/services/dev-server-store";
import { createDevServerService } from "../../src/services/dev-server-service";

const TASK_SESSION = {
    "x-taskflow-project-id": "p1",
    "x-taskflow-task-id": "t1",
    "x-taskflow-session-id": "s1",
};
const PROJECT_SESSION = {
    "x-taskflow-project-id": "p1",
    "x-taskflow-session-id": "s2",
};
const OTHER_TASK_SESSION = {
    "x-taskflow-project-id": "p1",
    "x-taskflow-task-id": "t2",
    "x-taskflow-session-id": "s3",
};

let tempDir: string;
let apiRouter: ApiRouter;
let events: WsEvent[];

beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "taskflow-dev-server-routes-"));
    apiRouter = new ApiRouter();
    events = [];
    registerDevServerRoutes({
        apiRouter,
        devServerService: createDevServerService({
            store: new DevServerStore(join(tempDir, "dev-servers.json")),
            broadcast: (event) => {
                events.push(event);
            },
            stopProcess: async () => ({ status: "stopped" }),
        }),
    });
});

afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
});

async function call(
    method: string,
    path: string,
    init: { headers?: Record<string, string>; body?: string } = {},
): Promise<Response> {
    const response = await apiRouter.handle(
        new Request(`http://localhost${path}`, {
            method,
            headers: { "Content-Type": "application/json", ...init.headers },
            ...(init.body === undefined ? {} : { body: init.body }),
        }),
    );
    if (!response) throw new Error(`No route for ${method} ${path}`);
    return response;
}

async function register(
    headers: Record<string, string>,
    pid: number,
    label = "UI dev server :5173",
): Promise<DevServer> {
    const response = await call("POST", "/api/dev-servers", {
        headers,
        body: JSON.stringify({ pid, label }),
    });
    expect(response.status).toBe(201);
    return (await response.json()) as DevServer;
}

async function listed(response: Response): Promise<number[]> {
    const { devServers } = (await response.json()) as DevServerListResponse;
    return devServers.map((server) => server.pid).sort((a, b) => a - b);
}

describe("POST /api/dev-servers", () => {
    it("registers a server against the caller's owner and broadcasts the list", async () => {
        const created = await register(TASK_SESSION, 4242);

        expect(created).toMatchObject({
            pid: 4242,
            label: "UI dev server :5173",
            projectId: "p1",
            taskId: "t1",
            sessionId: "s1",
        });
        expect(typeof created.id).toBe("string");
        expect(events.at(-1)).toEqual({
            type: MSG.DEV_SERVER_LIST,
            payload: { devServers: [created] },
        });
    });

    it("registers a project-level server without a task", async () => {
        const created = await register(PROJECT_SESSION, 4243);

        expect(created.projectId).toBe("p1");
        expect(created.taskId).toBeUndefined();
    });

    it("requires the project header", async () => {
        const response = await call("POST", "/api/dev-servers", {
            body: JSON.stringify({ pid: 4242, label: "UI :5173" }),
        });

        expect(response.status).toBe(400);
        expect(await response.json()).toEqual({
            error: "Missing required header: x-taskflow-project-id",
        });
        expect(events).toEqual([]);
    });

    it("rejects a body that isn't JSON", async () => {
        const response = await call("POST", "/api/dev-servers", {
            headers: TASK_SESSION,
            body: "not json",
        });

        expect(response.status).toBe(400);
        expect(await response.json()).toEqual({ error: "Invalid JSON body" });
    });

    it("returns the service's validation message as a 400", async () => {
        const cases: Array<{ body: unknown; error: string }> = [
            { body: { pid: 0, label: "UI" }, error: "Field 'pid' must be a positive integer" },
            { body: { pid: 1.5, label: "UI" }, error: "Field 'pid' must be a positive integer" },
            { body: { pid: "12", label: "UI" }, error: "Field 'pid' must be a positive integer" },
            {
                body: { pid: 12 },
                error: "Field 'label' is required and must be a non-empty string",
            },
            {
                body: { pid: 12, label: "   " },
                error: "Field 'label' is required and must be a non-empty string",
            },
            {
                body: { pid: 12, label: "x".repeat(81) },
                error: "Field 'label' must be at most 80 characters",
            },
            { body: null, error: "Field 'pid' must be a positive integer" },
        ];

        for (const { body, error } of cases) {
            const response = await call("POST", "/api/dev-servers", {
                headers: TASK_SESSION,
                body: JSON.stringify(body),
            });
            expect(response.status).toBe(400);
            expect(await response.json()).toEqual({ error });
        }
        expect(events).toEqual([]);
    });
});

describe("GET /api/dev-servers", () => {
    beforeEach(async () => {
        await register(TASK_SESSION, 1001);
        await register(PROJECT_SESSION, 1002);
        await register(OTHER_TASK_SESSION, 1003);
    });

    it("lists the calling task's servers", async () => {
        const response = await call("GET", "/api/dev-servers", { headers: TASK_SESSION });

        expect(response.status).toBe(200);
        expect(await listed(response)).toEqual([1001]);
    });

    it("lists a project session's servers without the tasks' ones", async () => {
        const response = await call("GET", "/api/dev-servers", { headers: PROJECT_SESSION });

        expect(await listed(response)).toEqual([1002]);
    });

    it("lists every server with all=1, no headers needed", async () => {
        const response = await call("GET", "/api/dev-servers?all=1");

        expect(response.status).toBe(200);
        expect(await listed(response)).toEqual([1001, 1002, 1003]);
    });

    it("requires the project header without all=1", async () => {
        const response = await call("GET", "/api/dev-servers");

        expect(response.status).toBe(400);
        expect(await response.json()).toEqual({
            error: "Missing required header: x-taskflow-project-id",
        });
    });
});

describe("DELETE /api/dev-servers", () => {
    it("removes by id, then reports 404", async () => {
        const created = await register(TASK_SESSION, 2001);

        const removed = await call("DELETE", `/api/dev-servers/${created.id}`);
        const again = await call("DELETE", `/api/dev-servers/${created.id}`);

        expect(removed.status).toBe(200);
        expect(await removed.json()).toEqual({ success: true });
        expect(again.status).toBe(404);
        expect(await again.json()).toEqual({ error: "Dev server not found" });
        expect(events.at(-1)).toEqual({
            type: MSG.DEV_SERVER_LIST,
            payload: { devServers: [] },
        });
    });

    it("removes by pid, then reports 404", async () => {
        await register(TASK_SESSION, 2002);

        const removed = await call("DELETE", "/api/dev-servers?pid=2002");
        const again = await call("DELETE", "/api/dev-servers?pid=2002");

        expect(removed.status).toBe(200);
        expect(await removed.json()).toEqual({ success: true });
        expect(again.status).toBe(404);
        expect(await again.json()).toEqual({ error: "Dev server not found" });
    });

    it("rejects a missing or invalid pid", async () => {
        for (const query of ["", "?pid=", "?pid=abc", "?pid=0", "?pid=-5", "?pid=1.5"]) {
            const response = await call("DELETE", `/api/dev-servers${query}`);
            expect(response.status).toBe(400);
            expect(await response.json()).toEqual({
                error: "Field 'pid' must be a positive integer",
            });
        }
    });

    it("sends no broadcast when nothing matched", async () => {
        await call("DELETE", "/api/dev-servers/unknown");
        await call("DELETE", "/api/dev-servers?pid=9999");

        expect(events).toEqual([]);
    });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd packages/backend && bun test tests/api/dev-server-routes.test.ts`
Expected: FAIL with a module-not-found error for `../../src/api/routes/dev-server-routes`.

- [ ] **Step 3: Write the routes**

Create `packages/backend/src/api/routes/dev-server-routes.ts`:

```ts
import type { ApiRouter } from "../router";
import type { DevServerListResponse } from "@taskflow/shared";
import type { DevServerService } from "../../services/dev-server-service";
import { DevServerInputError } from "../../services/dev-server-service";
import { jsonResponse, errorResponse } from "./response-helpers";

interface DevServerRouteDeps {
    apiRouter: ApiRouter;
    devServerService: DevServerService;
}

const MISSING_PROJECT = "Missing required header: x-taskflow-project-id";
const NOT_FOUND = "Dev server not found";
const BAD_PID = "Field 'pid' must be a positive integer";

function bodyField(body: unknown, name: string): unknown {
    if (typeof body !== "object" || body === null) return undefined;
    return (body as Record<string, unknown>)[name];
}

/** `?pid=` as a positive integer, or null. Digits only: "1.5", "-5" and "1e3" are refused. */
function queryPid(raw: string | null): number | null {
    if (raw === null || !/^\d+$/.test(raw)) return null;
    const pid = Number(raw);
    return Number.isSafeInteger(pid) && pid > 0 ? pid : null;
}

function registerDevServerRoutes(deps: DevServerRouteDeps): void {
    const { apiRouter, devServerService } = deps;

    apiRouter.register("POST", "/api/dev-servers", async (req) => {
        const projectId = req.headers.get("x-taskflow-project-id");
        if (!projectId) return errorResponse(MISSING_PROJECT, 400);
        const taskId = req.headers.get("x-taskflow-task-id") || undefined;
        const sessionId = req.headers.get("x-taskflow-session-id") || undefined;

        let body: unknown;
        try {
            body = await req.json();
        } catch {
            return errorResponse("Invalid JSON body", 400);
        }

        // Wrong JSON types become values the service refuses with its own message.
        const pid = bodyField(body, "pid");
        const label = bodyField(body, "label");
        try {
            const devServer = await devServerService.add({
                pid: typeof pid === "number" ? pid : Number.NaN,
                label: typeof label === "string" ? label : "",
                projectId,
                ...(taskId ? { taskId } : {}),
                ...(sessionId ? { sessionId } : {}),
            });
            return jsonResponse(devServer, 201);
        } catch (error) {
            if (error instanceof DevServerInputError) return errorResponse(error.message, 400);
            throw error;
        }
    });

    apiRouter.register("GET", "/api/dev-servers", async (req) => {
        const all = new URL(req.url).searchParams.get("all") === "1";
        const projectId = req.headers.get("x-taskflow-project-id");
        if (!all && !projectId) return errorResponse(MISSING_PROJECT, 400);
        const taskId = req.headers.get("x-taskflow-task-id") || undefined;

        const devServers = await devServerService.list();
        const response: DevServerListResponse = {
            devServers: all
                ? devServers
                : devServers.filter((server) =>
                      taskId
                          ? server.taskId === taskId
                          : server.projectId === projectId && !server.taskId,
                  ),
        };
        return jsonResponse(response);
    });

    apiRouter.register("DELETE", "/api/dev-servers/:id", async (_req, params) => {
        const removed = await devServerService.remove(params.id);
        if (!removed) return errorResponse(NOT_FOUND, 404);
        return jsonResponse({ success: true });
    });

    apiRouter.register("DELETE", "/api/dev-servers", async (req) => {
        const pid = queryPid(new URL(req.url).searchParams.get("pid"));
        if (pid === null) return errorResponse(BAD_PID, 400);
        const removed = await devServerService.removeByPid(pid);
        if (!removed) return errorResponse(NOT_FOUND, 404);
        return jsonResponse({ success: true });
    });
}

export { registerDevServerRoutes };
```

The `(body as Record<string, unknown>)` in `bodyField` follows the non-null object check. It's the codebase's usual narrowing for parsed JSON, not `as any`. If eslint flags it, use `Object.entries(body).find(([key]) => key === name)?.[1]` instead. Don't add a disable comment.

- [ ] **Step 4: Register the routes in `api/routes.ts`**

In `packages/backend/src/api/routes.ts`:

1. Next to the other service type imports, add:
   ```ts
   import type { DevServerService } from "../services/dev-server-service";
   ```
2. Next to the other route imports, add:
   ```ts
   import { registerDevServerRoutes } from "./routes/dev-server-routes";
   ```
3. In `interface ApiRouteDeps`, directly after `notificationStore: NotificationStore;`, add:
   ```ts
       devServerService: DevServerService;
   ```
4. In `registerApiRoutes`, directly after `registerNotificationRoutes(deps);`, add:
   ```ts
       registerDevServerRoutes(deps);
   ```

- [ ] **Step 5: Run the route tests to verify they pass**

Run: `cd packages/backend && bun test tests/api/dev-server-routes.test.ts`
Expected: PASS (13 tests).

- [ ] **Step 6: Keep `routes.test.ts` compiling, and pin the registration**

`ApiRouteDeps.devServerService` is now required. Every `registerApiRoutes({...})` call in `packages/backend/tests/api/routes.test.ts` spreads `sharedTestDeps`, so add one fake there. In `const sharedTestDeps = { … }`, after `generateScheduleName`:

```ts
    devServerService: {
        list: async () => [],
        add: async () => {
            throw new Error("not used in these tests");
        },
        remove: async () => false,
        removeByPid: async () => false,
        stop: async () => ({ ok: true as const }),
    },
```

Then add this test inside the first `describe("api routes", …)` block, after "reports a session's current owner, or 404":

```ts
    it("registers the dev server routes", async () => {
        const response = await apiRouter.handle(
            new Request("http://localhost/api/dev-servers?all=1", { method: "GET" }),
        );

        expect(response?.status).toBe(200);
        expect(await response?.json()).toEqual({ devServers: [] });
    });
```

- [ ] **Step 7: Run the routes suites and typecheck**

Run: `cd packages/backend && bun test tests/api/routes.test.ts tests/api/dev-server-routes.test.ts`
Expected: PASS.

Run: `cd packages/backend && bun run typecheck`
Expected: exactly one error, in `src/index.ts`: the `registerApiRoutes` call is missing `devServerService`. Task 2.3 fixes it. If anything else fails, fix it before going on.

- [ ] **Step 8: Don't commit yet**

Committing now would leave `main` failing typecheck. Task 2.2's files are committed together with Task 2.3's, in Task 2.3 Step 8.

### Task 2.3: WS handlers and wiring in `index.ts`

**Files:**
- Create: `packages/backend/src/handlers/dev-server.ts`.
- Create: `packages/backend/tests/handlers/dev-server.test.ts`.
- Modify: `packages/backend/src/index.ts`:
  - imports next to `NotificationStore` and `registerNotificationHandlers` (lines 52-53);
  - service creation and handler registration directly after the `registerNotificationHandlers({ … });` call (around line 361);
  - `devServerService` in the `registerApiRoutes({ … })` call, directly after `notificationStore,` (around line 406).

**Interfaces:**
- Consumes (Section 1):
  - `createDevServerService`, `DevServerService` and `DevServerStore`;
  - the `StopProcess` type;
  - `MSG.DEV_SERVER_LIST`, `MSG.DEV_SERVER_STOP`, `DevServerListResponse` and `DevServerStopResult`.
- Produces:
  - `registerDevServerHandlers({ router, devServerService })`, imported only by `index.ts`.
  - WS `MSG.DEV_SERVER_LIST` (`{}` → `DevServerListResponse`, every record on this backend).
  - WS `MSG.DEV_SERVER_STOP` (`{ id }` → `DevServerStopResult`).
  - The real `DevServerService` instance in `index.ts`, built on `config.devServersFile` and broadcasting through `server.broadcast`.

- [ ] **Step 1: Write the failing handler tests**

Create `packages/backend/tests/handlers/dev-server.test.ts`:

```ts
import { afterEach, beforeEach, expect, it } from "bun:test";
import { mkdtemp, rm } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import {
    MSG,
    type DevServerListResponse,
    type DevServerStopResult,
    type WsEvent,
} from "@taskflow/shared";
import { TestRouter } from "../test-router";
import { expectRejects } from "../expect-rejects";
import { DevServerStore } from "../../src/services/dev-server-store";
import {
    createDevServerService,
    type DevServerService,
} from "../../src/services/dev-server-service";
import type { StopProcess } from "../../src/services/process-stopper";
import { registerDevServerHandlers } from "../../src/handlers/dev-server";

let tempDir: string;
let router: TestRouter;
let service: DevServerService;
let events: WsEvent[];
let outcome: Awaited<ReturnType<StopProcess>>;
let stopCalls: Array<{ pid: number; registeredAt: string }>;

beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "taskflow-dev-server-handlers-"));
    events = [];
    stopCalls = [];
    outcome = { status: "stopped" };
    service = createDevServerService({
        store: new DevServerStore(join(tempDir, "dev-servers.json")),
        broadcast: (event) => {
            events.push(event);
        },
        stopProcess: async (pid, registeredAt) => {
            stopCalls.push({ pid, registeredAt });
            return outcome;
        },
    });
    router = new TestRouter();
    registerDevServerHandlers({ router, devServerService: service });
});

afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
});

it("lists every dev server on the backend, whatever its owner", async () => {
    await service.add({ pid: 3001, label: "UI :5173", projectId: "p1", taskId: "t1" });
    await service.add({ pid: 3002, label: "Expo :8087", projectId: "p2" });

    const listed = (await router.handle(MSG.DEV_SERVER_LIST, {})) as DevServerListResponse;

    expect(listed.devServers.map((server) => server.pid).sort()).toEqual([3001, 3002]);
});

it("stops a dev server and drops it from the list", async () => {
    const created = await service.add({ pid: 3003, label: "UI :5173", projectId: "p1" });
    events.length = 0;

    const result = (await router.handle(MSG.DEV_SERVER_STOP, {
        id: created.id,
    })) as DevServerStopResult;

    expect(result).toEqual({ ok: true });
    expect(stopCalls).toEqual([{ pid: 3003, registeredAt: created.registeredAt }]);
    expect(await service.list()).toEqual([]);
    expect(events).toEqual([{ type: MSG.DEV_SERVER_LIST, payload: { devServers: [] } }]);
});

it("keeps the record and returns the error when the stop fails", async () => {
    const created = await service.add({ pid: 3004, label: "UI :5173", projectId: "p1" });
    outcome = { status: "failed", error: "Could not stop pid 3004: operation not permitted" };

    const result = (await router.handle(MSG.DEV_SERVER_STOP, {
        id: created.id,
    })) as DevServerStopResult;

    expect(result).toEqual({
        ok: false,
        error: "Could not stop pid 3004: operation not permitted",
    });
    expect(await service.list()).toEqual([created]);
});

it("rejects a stop without a string id", async () => {
    await expectRejects(router.handle(MSG.DEV_SERVER_STOP, {}), /Field 'id' is required/);
    await expectRejects(router.handle(MSG.DEV_SERVER_STOP, { id: 7 }), /Field 'id' is required/);
    await expectRejects(router.handle(MSG.DEV_SERVER_STOP, null), /Field 'id' is required/);
    expect(stopCalls).toEqual([]);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd packages/backend && bun test tests/handlers/dev-server.test.ts`
Expected: FAIL with a module-not-found error for `../../src/handlers/dev-server`.

- [ ] **Step 3: Write the handlers**

Create `packages/backend/src/handlers/dev-server.ts`. The payload is narrowed in place, the way `handlers/builtin-action.ts` does it. There's no `typed<T>` helper and no new eslint-disable comment.

```ts
import { MSG } from "@taskflow/shared";
import type { DevServerListResponse, DevServerStopResult } from "@taskflow/shared";
import type { Router } from "../ws/router";
import type { DevServerService } from "../services/dev-server-service";

interface DevServerHandlerDeps {
    router: Router;
    devServerService: DevServerService;
}

function registerDevServerHandlers({ router, devServerService }: DevServerHandlerDeps): void {
    router.register(
        MSG.DEV_SERVER_LIST,
        async (): Promise<DevServerListResponse> => ({
            devServers: await devServerService.list(),
        }),
    );

    router.register(MSG.DEV_SERVER_STOP, async (payload): Promise<DevServerStopResult> => {
        const id =
            typeof payload === "object" && payload !== null && "id" in payload
                ? payload.id
                : undefined;
        if (typeof id !== "string" || !id) throw new Error("Field 'id' is required");
        return devServerService.stop(id);
    });
}

export { registerDevServerHandlers };
```

- [ ] **Step 4: Run the handler tests to verify they pass**

Run: `cd packages/backend && bun test tests/handlers/dev-server.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Wire the service into `index.ts`**

In `packages/backend/src/index.ts`:

1. After the imports of `NotificationStore` and `registerNotificationHandlers` (lines 52-53), add:
   ```ts
   import { DevServerStore } from "./services/dev-server-store";
   import { createDevServerService } from "./services/dev-server-service";
   import { registerDevServerHandlers } from "./handlers/dev-server";
   ```
2. Directly after the `registerNotificationHandlers({ router, notificationStore, broadcast: server.broadcast });` call (around line 361), add:
   ```ts
           const devServerService = createDevServerService({
               store: new DevServerStore(config.devServersFile),
               broadcast: server.broadcast,
           });
           registerDevServerHandlers({ router, devServerService });
   ```
   `stopProcess` is left out, so the service uses the real stopper (Section 1 default).
3. In the `registerApiRoutes({ … })` call, directly after `notificationStore,`, add:
   ```ts
               devServerService,
   ```

- [ ] **Step 6: Typecheck, lint, format, full backend suite**

Run, from the repo root:

```bash
bun run typecheck
bunx eslint packages/backend/src/config.ts packages/backend/src/api/routes.ts \
  packages/backend/src/api/routes/dev-server-routes.ts packages/backend/src/handlers/dev-server.ts \
  packages/backend/src/index.ts packages/backend/tests/api/dev-server-routes.test.ts \
  packages/backend/tests/api/routes.test.ts packages/backend/tests/handlers/dev-server.test.ts \
  packages/backend/tests/config/dev-servers-file.test.ts
bunx prettier --check packages/backend/src/config.ts packages/backend/src/api/routes.ts \
  packages/backend/src/api/routes/dev-server-routes.ts packages/backend/src/handlers/dev-server.ts \
  packages/backend/tests/api/dev-server-routes.test.ts packages/backend/tests/api/routes.test.ts \
  packages/backend/tests/handlers/dev-server.test.ts packages/backend/tests/config/dev-servers-file.test.ts
cd packages/backend && bun test
```

Expected:
- typecheck passes with no errors (the Task 2.2 error in `index.ts` is gone);
- eslint is clean;
- prettier passes (fix with `bunx prettier --write <file>` on these files only);
- the full suite passes. Rerun the known flaky `platform.test.ts` test once if it fails.

`src/index.ts` already failed `prettier --check` before TSK-3; it's left out of the prettier list above. Don't reformat it.

- [ ] **Step 7: Smoke-test the wiring against a sandboxed backend**

This checks that `index.ts` builds the service and that HTTP and WS reach it. Use a fake HOME and a dev port, so the real data and the real `~/.config/taskflow` stay untouched (see the memory note "Dev backend sandbox"):

```bash
SANDBOX=$(mktemp -d)
HOME=$SANDBOX TASKFLOW_DEV_PORT=18811 bun run packages/backend/src/index.ts > "$SANDBOX/backend.log" 2>&1 &
BACKEND=$!
sleep 3
sleep 600 & SLEEPER=$!
curl -s -X POST http://127.0.0.1:18811/api/dev-servers \
  -H "Content-Type: application/json" -H "X-Taskflow-Project-Id: p1" \
  -d "{\"pid\":$SLEEPER,\"label\":\"smoke :0\"}"
curl -s "http://127.0.0.1:18811/api/dev-servers?all=1"
ls "$SANDBOX/.config/taskflow/" | grep dev-servers
curl -s -X DELETE "http://127.0.0.1:18811/api/dev-servers?pid=$SLEEPER"
kill $SLEEPER $BACKEND
```

Expected:
- the POST returns the record (`"pid":<SLEEPER>`, `"projectId":"p1"`);
- the list contains it;
- a `dev-servers-<instanceId>.json` file appears under the sandbox's config dir;
- the DELETE returns `{"success":true}`.

If the backend doesn't listen on 18811, check `$SANDBOX/backend.log` and how `TASKFLOW_DEV_PORT` is read in `config.ts`. Record what worked in `handoff.md` for Section 5. Stopping through WS is exercised by the UI in Section 5.

- [ ] **Step 8: Commit**

```bash
git add packages/backend/src/api/routes/dev-server-routes.ts packages/backend/src/api/routes.ts \
  packages/backend/tests/api/dev-server-routes.test.ts packages/backend/tests/api/routes.test.ts \
  packages/backend/src/handlers/dev-server.ts packages/backend/tests/handlers/dev-server.test.ts \
  packages/backend/src/index.ts
git commit -m "feat(backend): HTTP and WS API for dev servers, wired into the backend"
```

### After this section

Update `handoff.md`:
- **Status row:** the two commits (Task 2.1, and Tasks 2.2 + 2.3 together).
- **Produced:**
  - `config.devServersFile`;
  - `registerDevServerRoutes` (`api/routes/dev-server-routes.ts`);
  - `registerDevServerHandlers` (`handlers/dev-server.ts`);
  - `ApiRouteDeps.devServerService`;
  - in `index.ts`, the `devServerService` instance after `registerNotificationHandlers`.
- **The exact smoke-test commands that worked**, for Section 5.
- **Facts Section 3 needs:** the CLI sends `X-Taskflow-Project-Id` / `X-Taskflow-Task-Id` / `X-Taskflow-Session-Id`; HTTP header names are case-insensitive; `GET` without `all=1` needs the project header.
