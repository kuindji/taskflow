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
