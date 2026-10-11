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
