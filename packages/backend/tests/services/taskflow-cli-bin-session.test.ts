import { afterEach, describe, expect, it } from "bun:test";
import { join } from "path";

const binPath = join(import.meta.dir, "../../src/services/taskflow-cli-bin.ts");

interface Recorded {
    method: string;
    path: string;
    body: string;
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
            requests.push({ method: req.method, path: url.pathname, body: await req.text() });
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
