import { afterEach, describe, expect, it } from "bun:test";
import { join } from "path";

const binPath = join(import.meta.dir, "../../src/services/taskflow-cli-bin.ts");

interface Recorded {
    method: string;
    path: string;
    body: string;
    authorization: string | null;
}

let server: ReturnType<typeof Bun.serve> | null = null;

afterEach(() => {
    void server?.stop(true);
    server = null;
});

function startServer(owner: unknown, moveStatus = 200) {
    const requests: Recorded[] = [];
    server = Bun.serve({
        port: 0,
        async fetch(req) {
            const url = new URL(req.url);
            requests.push({
                method: req.method,
                path: url.pathname,
                authorization: req.headers.get("authorization"),
                body: await req.text(),
            });
            if (url.pathname.endsWith("/owner")) {
                return owner ? Response.json(owner) : new Response("{}", { status: 404 });
            }
            if (url.pathname.endsWith("/move")) {
                return moveStatus === 200
                    ? Response.json({ success: true })
                    : Response.json(
                          { error: "Flow sessions cannot be moved" },
                          { status: moveStatus },
                      );
            }
            return Response.json({ id: "ok" });
        },
    });
    return requests;
}

interface RecordedDevServerRequest {
    method: string;
    path: string; // pathname + search
    body: string;
    authorization: string | null;
    project: string | null;
    task: string | null;
    session: string | null;
}

function startDevServerApi(status = 200, payload: unknown = { id: "d1" }) {
    const requests: RecordedDevServerRequest[] = [];
    server = Bun.serve({
        port: 0,
        async fetch(req) {
            const url = new URL(req.url);
            if (url.pathname.endsWith("/owner")) {
                // Unknown session: the binary keeps its env owner.
                return new Response("{}", { status: 404 });
            }
            requests.push({
                method: req.method,
                path: url.pathname + url.search,
                authorization: req.headers.get("authorization"),
                body: await req.text(),
                project: req.headers.get("x-taskflow-project-id"),
                task: req.headers.get("x-taskflow-task-id"),
                session: req.headers.get("x-taskflow-session-id"),
            });
            return Response.json(payload, { status });
        },
    });
    return requests;
}

// Async on purpose: a blocking spawn would stall the in-process server.
async function runBin(args: string[], env: Record<string, string>) {
    const proc = Bun.spawn(["bun", binPath, ...args], {
        stdout: "pipe",
        stderr: "pipe",
        env: {
            ...process.env,
            TASKFLOW_TASK_ID: "",
            TASKFLOW_PROJECT_ID: "",
            TASKFLOW_SESSION_ID: "",
            TASKFLOW_API_TOKEN: "",
            TASKFLOW_API_URL: `http://127.0.0.1:${server?.port}`,
            ...env,
        },
    });
    const [stdout, stderr, status] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
    ]);
    return { stdout, stderr, status };
}

describe("taskflow-cli binary: session owner", () => {
    it("uses the session's current owner over the env task", async () => {
        const requests = startServer({ taskId: "new-task", projectId: "p1" });
        const result = await runBin(["task"], {
            TASKFLOW_TASK_ID: "old-task",
            TASKFLOW_SESSION_ID: "s1",
        });

        expect(result.status).toBe(0);
        expect(requests.map((r) => r.path)).toEqual([
            "/api/sessions/s1/owner",
            "/api/tasks/new-task",
        ]);
    });

    it("keeps the env task when the lookup 404s", async () => {
        const requests = startServer(null);
        const result = await runBin(["task"], {
            TASKFLOW_TASK_ID: "task-1",
            TASKFLOW_SESSION_ID: "s1",
        });

        expect(result.status).toBe(0);
        expect(requests.at(-1)?.path).toBe("/api/tasks/task-1");
    });

    it("keeps the env task when the lookup names no owner", async () => {
        const requests = startServer({});
        const result = await runBin(["task"], {
            TASKFLOW_TASK_ID: "task-1",
            TASKFLOW_SESSION_ID: "s1",
        });

        expect(result.status).toBe(0);
        expect(requests.at(-1)?.path).toBe("/api/tasks/task-1");
    });

    it("skips the lookup for an explicit --task", async () => {
        const requests = startServer({ taskId: "other" });
        await runBin(["--task", "explicit", "task"], { TASKFLOW_SESSION_ID: "s1" });

        expect(requests.map((r) => r.path)).toEqual(["/api/tasks/explicit"]);
    });

    it("moves the caller's session", async () => {
        const requests = startServer(null);
        const result = await runBin(["session", "move", "--master"], {
            TASKFLOW_SESSION_ID: "s1",
        });

        expect(result.status).toBe(0);
        expect(requests.at(-1)).toEqual({
            method: "POST",
            path: "/api/sessions/s1/move",
            body: '{"master":true}',
            authorization: null,
        });
    });

    it("rejects zero, several, repeated or stray targets", async () => {
        startServer(null);
        for (const args of [
            [],
            ["--task", "t", "--project", "p"],
            ["--task", "t", "--task", "u"],
            ["t2"],
        ]) {
            const result = await runBin(["session", "move", ...args], {
                TASKFLOW_SESSION_ID: "s1",
            });
            expect(result.status).toBe(1);
        }
    });

    it("surfaces the backend refusal", async () => {
        startServer(null, 400);
        const result = await runBin(["session", "move", "--task", "t2"], {
            TASKFLOW_SESSION_ID: "s1",
        });

        expect(result.status).toBe(1);
        expect(result.stderr).toContain("Flow sessions cannot be moved");
    });
});

describe("taskflow-cli binary: flow context", () => {
    const flowEnv = {
        TASKFLOW_FLOW_ID: "flow-1",
        TASKFLOW_ACTION_ENTRY_ID: "entry-1",
        TASKFLOW_SESSION_ID: "session-1",
    };

    it("names the master owner from a master-workspace flow session", async () => {
        const requests = startServer(null);
        for (const args of [
            ["action", "complete"],
            ["flow", "complete"],
            ["artifact", "save", "summary", "--text", "done"],
            ["artifact", "list"],
            ["flow", "input"],
            ["flow", "status"],
            ["flow", "status", "flow-1"],
            ["flow", "stop", "flow-1"],
            ["flow", "pause", "flow-1"],
            ["flow", "resume", "flow-1"],
            ["flow", "skip", "flow-1"],
            ["flow", "jump", "flow-1", "2"],
        ]) {
            expect((await runBin(args, flowEnv)).status).toBe(0);
        }

        const calls = requests.filter((r) => !r.path.endsWith("/owner"));
        expect(calls.map((r) => r.path)).toEqual([
            "/api/flow/action-complete",
            "/api/flow/complete",
            "/api/flow/artifact",
            "/api/flow/artifact/__master__/flow-1",
            "/api/flow/input/__master__/flow-1",
            "/api/flow-runs/__master__",
            "/api/flow-runs/__master__/flow-1",
            "/api/flows/__master__/flow-1/stop",
            "/api/flows/__master__/flow-1/pause",
            "/api/flows/__master__/flow-1/resume",
            "/api/flows/__master__/flow-1/skip",
            "/api/flows/__master__/flow-1/jump",
        ]);
        for (const r of calls.slice(0, 3)) {
            const body = JSON.parse(r.body) as Record<string, unknown>;
            expect(body.master).toBe(true);
            expect(body.taskId).toBeUndefined();
            expect(body.projectId).toBeUndefined();
        }
    });

    it("encodes the artifact label as one path segment on get", async () => {
        const requests = startServer(null);
        const result = await runBin(["artifact", "get", "code review#2/é"], {
            ...flowEnv,
            TASKFLOW_TASK_ID: "task-1",
        });

        expect(result.status).toBe(0);
        const prefix = "/api/flow/artifact/task-1/flow-1/";
        const get = requests.find((r) => r.path.startsWith(prefix));
        expect(decodeURIComponent(get?.path.slice(prefix.length) ?? "")).toBe("code review#2/é");
    });

    it("saves a relative artifact path as an absolute one", async () => {
        const requests = startServer(null);
        const result = await runBin(["artifact", "save", "plan", "--path", "docs/plan.md"], {
            ...flowEnv,
            TASKFLOW_TASK_ID: "task-1",
        });

        expect(result.status).toBe(0);
        const save = requests.find((r) => r.path === "/api/flow/artifact");
        expect((JSON.parse(save?.body ?? "{}") as { path?: string }).path).toBe(
            join(process.cwd(), "docs/plan.md"),
        );
    });
});

describe("taskflow-cli binary: agent run", () => {
    const owner = { TASKFLOW_PROJECT_ID: "p1", TASKFLOW_TASK_ID: "t1" };

    async function runAgent(args: string[]) {
        const requests = startDevServerApi(201, { sessionId: "s2" });
        const result = await runBin(["agent", "run", ...args], owner);
        return { result, body: JSON.parse(requests.at(-1)?.body ?? "{}") as unknown };
    }

    it("starts on the caller's own task by default", async () => {
        const { result, body } = await runAgent(["--prompt", "go"]);

        expect(result.status).toBe(0);
        expect(body).toEqual({ projectId: "p1", taskId: "t1", prompt: "go" });
    });

    it("sends only the task for an explicit --task so its project is resolved", async () => {
        const { body } = await runAgent(["--task", "t9"]);

        expect(body).toEqual({ taskId: "t9" });
    });

    it("starts a project-level session for --project, ignoring the caller's task", async () => {
        const { body } = await runAgent(["--project", "p2"]);

        expect(body).toEqual({ projectId: "p2" });
    });

    it("passes --account to the default agent when no agent is named", async () => {
        const { body } = await runAgent(["--account", "work"]);

        expect(body).toMatchObject({ agentOptions: { account: "work" } });
    });

    it("sends both for --task with --project", async () => {
        const { body } = await runAgent(["--task", "t9", "--project", "p2"]);

        expect(body).toEqual({ taskId: "t9", projectId: "p2" });
    });
});

describe("taskflow-cli binary: devserver", () => {
    const owner = {
        TASKFLOW_PROJECT_ID: "p1",
        TASKFLOW_TASK_ID: "t1",
        TASKFLOW_SESSION_ID: "s1",
    };

    it("registers a dev server with the caller's owner headers", async () => {
        const requests = startDevServerApi(201);
        const result = await runBin(
            ["devserver", "add", "--pid", "04821", "--label", 'UI "dev" :5173'],
            owner,
        );

        expect(result.status).toBe(0);
        expect(result.stdout).toContain('"id":"d1"');
        expect(requests).toEqual([
            {
                method: "POST",
                path: "/api/dev-servers",
                body: '{"pid":4821,"label":"UI \\"dev\\" :5173"}',
                project: "p1",
                task: "t1",
                session: "s1",
                authorization: null,
            },
        ]);
    });

    it("refuses add without a numeric --pid and a --label, before any request", async () => {
        const requests = startDevServerApi();
        for (const args of [
            ["--label", "x"],
            ["--pid", "1"],
            ["--pid", "abc", "--label", "x"],
            ["--pid", "1", "--label", ""],
            ["--pid", "1", "--label", "x", "stray"],
            ["--pid", "1", "--label", "x", "--port", "3000"],
            ["--pid", "1", "--label", "x", "-x"],
            ["--pid", "1", "--label", "x", "--"],
            ["--", "--pid", "1", "--label", "x"],
        ]) {
            const result = await runBin(["devserver", "add", ...args], owner);
            expect(result.status).toBe(1);
            expect(result.stderr).toContain("Usage: taskflow-cli devserver add");
        }
        expect(requests).toEqual([]);
    });

    it("takes `--` as a flag's value, not as end-of-flags", async () => {
        const requests = startDevServerApi(201);
        const result = await runBin(["devserver", "add", "--pid", "1", "--label", "--"], owner);

        expect(result.status).toBe(0);
        expect(requests.map((r) => r.body)).toEqual(['{"pid":1,"label":"--"}']);
    });

    it("refuses add, list and remove without project context", async () => {
        const requests = startDevServerApi();
        for (const args of [
            ["add", "--pid", "1", "--label", "x"],
            ["list"],
            ["remove", "d1"],
            ["remove", "--pid", "1"],
        ]) {
            const result = await runBin(["devserver", ...args], {});
            expect(result.status).toBe(1);
            expect(result.stderr).toContain("TASKFLOW_PROJECT_ID is not set");
        }
        expect(requests).toEqual([]);
    });

    it("surfaces the backend's validation error", async () => {
        startDevServerApi(400, { error: "Field 'label' must be at most 80 characters" });
        const result = await runBin(["devserver", "add", "--pid", "1", "--label", "x"], owner);

        expect(result.status).toBe(1);
        expect(result.stderr).toContain("Field 'label' must be at most 80 characters");
    });

    it("lists the caller's dev servers, or all of them with --all", async () => {
        const requests = startDevServerApi(200, { devServers: [] });

        expect((await runBin(["devserver", "list"], owner)).status).toBe(0);
        expect((await runBin(["devserver", "list", "--all"], {})).status).toBe(0);
        // Like the sh script, --all still sends whatever context is set.
        expect((await runBin(["devserver", "list", "--all"], owner)).status).toBe(0);
        for (const args of [["--mine"], ["-x"], ["--"]]) {
            expect((await runBin(["devserver", "list", ...args], owner)).status).toBe(1);
        }

        expect(requests.map((r) => [r.method, r.path, r.project])).toEqual([
            ["GET", "/api/dev-servers", "p1"],
            ["GET", "/api/dev-servers?all=1", null],
            ["GET", "/api/dev-servers?all=1", "p1"],
        ]);
    });

    it("removes by id or by pid", async () => {
        const requests = startDevServerApi(200, { success: true });

        expect((await runBin(["devserver", "remove", "d1"], owner)).status).toBe(0);
        expect((await runBin(["devserver", "remove", "--pid", "007"], owner)).status).toBe(0);

        expect(requests.map((r) => [r.method, r.path, r.project])).toEqual([
            ["DELETE", "/api/dev-servers/d1", "p1"],
            ["DELETE", "/api/dev-servers?pid=7", "p1"],
        ]);
    });

    it("refuses remove without exactly one of <id> or --pid", async () => {
        const requests = startDevServerApi();
        for (const args of [
            [],
            ["d1", "d2"],
            ["d1", "--pid", "5"],
            ["--pid", "5", "--pid", "6"],
            ["--pid", "x"],
            ["--all"],
            ["-x"],
            ["--", "d1"],
            ["d1", "--"],
        ]) {
            const result = await runBin(["devserver", "remove", ...args], owner);
            expect(result.status).toBe(1);
            expect(result.stderr).toContain("Usage: taskflow-cli devserver remove");
        }
        expect(requests).toEqual([]);
    });

    it("prints usage for an unknown subcommand", async () => {
        startDevServerApi();
        const result = await runBin(["devserver", "stop", "d1"], owner);

        expect(result.status).toBe(1);
        expect(result.stderr).toContain("Usage: taskflow-cli devserver <add|list|remove>");
    });
});

describe("taskflow-cli binary: browser", () => {
    const owner = {
        TASKFLOW_TASK_ID: "task-1",
        TASKFLOW_PROJECT_ID: "project-1",
        TASKFLOW_SESSION_ID: "session-1",
    };

    it("browser open posts url and label to /api/browser/tabs with context headers", async () => {
        const response = { tab: { id: "b1" }, endpoint: "http://localhost:1234/cdp/b1" };
        const requests = startDevServerApi(201, response);
        const result = await runBin(
            ["browser", "open", "https://example.com/docs", "--label", 'Docs "guide"'],
            owner,
        );
        expect(result.status).toBe(0);
        expect(JSON.parse(result.stdout)).toEqual(response);
        expect(requests).toEqual([
            {
                method: "POST",
                path: "/api/browser/tabs",
                body: JSON.stringify({ url: "https://example.com/docs", label: 'Docs "guide"' }),
                task: "task-1",
                project: "project-1",
                session: "session-1",
                authorization: null,
            },
        ]);
    });

    for (const scope of ["project", "master"]) {
        it(`browser open --${scope} sends scope ${scope}`, async () => {
            const requests = startDevServerApi();
            const result = await runBin(
                ["browser", "open", "https://example.com", `--${scope}`],
                owner,
            );
            expect(result.status).toBe(0);
            expect(requests[0]?.method).toBe("POST");
            expect(requests[0]?.path).toBe("/api/browser/tabs");
            expect(JSON.parse(requests[0].body)).toEqual({ url: "https://example.com", scope });
        });
    }

    it("browser <url> (old form) posts like open", async () => {
        const requests = startDevServerApi();
        const result = await runBin(
            ["browser", "https://example.com", "--label", "Docs", "--project"],
            owner,
        );
        expect(result.status).toBe(0);
        expect(requests[0]?.method).toBe("POST");
        expect(requests[0]?.path).toBe("/api/browser/tabs");
        expect(JSON.parse(requests[0].body)).toEqual({
            url: "https://example.com",
            label: "Docs",
            scope: "project",
        });
    });

    for (const [name, args, method, path] of [
        ["browser list GETs /api/browser/tabs", ["browser", "list"], "GET", "/api/browser/tabs"],
        [
            "browser list --project adds ?scope=project",
            ["browser", "list", "--project"],
            "GET",
            "/api/browser/tabs?scope=project",
        ],
        [
            "browser list --master adds ?scope=master",
            ["browser", "list", "--master"],
            "GET",
            "/api/browser/tabs?scope=master",
        ],
        [
            "browser close <id> sends DELETE to /api/browser/tabs/<id>",
            ["browser", "close", "b1"],
            "DELETE",
            "/api/browser/tabs/b1",
        ],
    ] as const) {
        it(name, async () => {
            const requests = startDevServerApi(200, { success: true });
            const result = await runBin([...args], owner);
            expect(result.status).toBe(0);
            expect(JSON.parse(result.stdout)).toEqual({ success: true });
            expect(requests).toEqual([
                {
                    method,
                    path,
                    body: "",
                    task: "task-1",
                    project: "project-1",
                    session: "session-1",
                    authorization: null,
                },
            ]);
        });
    }

    for (const [name, args] of [
        ["browser with no args prints usage and exits 1", ["browser"]],
        ["browser open without URL prints usage and exits 1", ["browser", "open"]],
        ["browser close without id prints usage and exits 1", ["browser", "close"]],
        [
            "browser open --label without text prints usage and exits 1",
            ["browser", "open", "https://example.com", "--label"],
        ],
    ] as const) {
        it(name, async () => {
            const requests = startDevServerApi();
            const result = await runBin([...args], owner);
            expect(result.status).toBe(1);
            expect(result.stderr).toContain(
                "Usage: taskflow-cli browser open <url> [--label <label>] [--project|--master] | list [--project|--master] | close <tabId>",
            );
            expect(requests).toEqual([]);
        });
    }

    it("browser open on a 503 exits 1 and the output carries the exact unavailable message", async () => {
        const message =
            "Browser not available on this machine: the Taskflow desktop app must be running here";
        startDevServerApi(503, { error: message });
        const result = await runBin(["browser", "open", "https://example.com"], owner);
        expect(result.status).toBe(1);
        expect(result.stderr).toContain(
            `Error: POST /api/browser/tabs returned 503: ${JSON.stringify({ error: message })}`,
        );
    });
});

describe("taskflow-cli binary: authentication", () => {
    const token = "T".repeat(43);

    it("api() sends Authorization: Bearer <TASKFLOW_API_TOKEN>", async () => {
        const requests = startDevServerApi(200, { devServers: [] });
        const result = await runBin(["devserver", "list", "--all"], { TASKFLOW_API_TOKEN: token });
        expect(result.status).toBe(0);
        expect(requests.map((request) => request.authorization)).toEqual([`Bearer ${token}`]);
    });

    it("the session owner lookup sends the token", async () => {
        const requests = startServer({ taskId: "new-task", projectId: "p1" });
        const result = await runBin(["task"], {
            TASKFLOW_API_TOKEN: token,
            TASKFLOW_SESSION_ID: "s1",
        });
        expect(result.status).toBe(0);
        expect(requests.map((request) => [request.path, request.authorization])).toEqual([
            ["/api/sessions/s1/owner", `Bearer ${token}`],
            ["/api/tasks/new-task", `Bearer ${token}`],
        ]);
    });

    it("no TASKFLOW_API_TOKEN sends no Authorization header", async () => {
        const requests = startServer({ taskId: "new-task", projectId: "p1" });
        const result = await runBin(["task"], { TASKFLOW_SESSION_ID: "s1" });
        expect(result.status).toBe(0);
        expect(requests.map((request) => request.authorization)).toEqual([null, null]);
    });
});

describe("taskflow-cli binary: flow and action definitions", () => {
    const flow = { id: "f1", name: "Ship", actions: [{ id: "e1", actionId: "a1" }] };

    it("reads one flow or action through its own route", async () => {
        const requests = startDevServerApi(200, flow);
        const flowResult = await runBin(["flow", "get", "f1"], {});
        expect(flowResult.status).toBe(0);
        expect(JSON.parse(flowResult.stdout)).toEqual(flow);
        const actionResult = await runBin(["action", "get", "a1"], {});
        expect(actionResult.status).toBe(0);
        expect(requests.map((r) => `${r.method} ${r.path}`)).toEqual([
            "GET /api/flows/f1",
            "GET /api/flow-actions/a1",
        ]);
    });

    it("patches only the changed fields", async () => {
        const requests = startDevServerApi(200, flow);
        const prompt = "Build & test src/main.ts";
        const actionResult = await runBin(
            ["action", "update", "a1", "--prompt", prompt, "--no-standalone"],
            {},
        );
        expect(actionResult.status).toBe(0);
        const flowResult = await runBin(["flow", "update", "f1", "--name", "Ship it"], {});
        expect(flowResult.status).toBe(0);
        expect(
            requests.map((r) => [`${r.method} ${r.path}`, JSON.parse(r.body) as unknown]),
        ).toEqual([
            ["PATCH /api/flow-actions/a1", { prompt, standalone: false }],
            ["PATCH /api/flows/f1", { name: "Ship it" }],
        ]);
    });

    it("fails for an unknown id with the backend's message", async () => {
        startDevServerApi(404, { error: "Flow not found: nope" });
        const result = await runBin(["flow", "get", "nope"], {});
        expect(result.status).toBe(1);
        expect(result.stderr).toContain("Flow not found: nope");
    });
});

describe("taskflow-cli binary: project paths", () => {
    it("sends relative project paths resolved against the caller's directory", async () => {
        const requests = startDevServerApi(200, { id: "p1" });
        expect((await runBin(["project", "add", ".", "--name", "Here"], {})).status).toBe(0);
        expect((await runBin(["project", "update", "p1", "--path", "sub"], {})).status).toBe(0);
        expect(requests.map((r) => JSON.parse(r.body) as unknown)).toEqual([
            { path: process.cwd(), name: "Here" },
            { path: join(process.cwd(), "sub") },
        ]);
    });
});

describe("taskflow-cli binary: project move", () => {
    it("sends the target to the move route", async () => {
        const requests = startDevServerApi(200, { projects: [] });
        for (const flags of [
            ["--to", "2"],
            ["--before", "p2"],
            ["--after", "p3"],
        ]) {
            const result = await runBin(["project", "move", "p1", ...flags], {});
            expect(result.status).toBe(0);
        }
        expect(
            requests.map((r) => [`${r.method} ${r.path}`, JSON.parse(r.body) as unknown]),
        ).toEqual([
            ["POST /api/projects/p1/move", { to: 2 }],
            ["POST /api/projects/p1/move", { before: "p2" }],
            ["POST /api/projects/p1/move", { after: "p3" }],
        ]);
    });
});
