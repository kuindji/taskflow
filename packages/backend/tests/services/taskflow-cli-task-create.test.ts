import { afterEach, describe, expect, it } from "bun:test";
import { join } from "path";

// `task create` must behave the same in both CLIs: the POSIX script runs on
// macOS/Linux, the TS binary on Windows. Each case runs against both, over
// real HTTP to a stub backend.
const IMPLEMENTATIONS = [
    {
        name: "shell script",
        argv: ["sh", join(import.meta.dir, "../../src/services/taskflow-cli.sh")],
    },
    {
        name: "TS binary",
        argv: ["bun", join(import.meta.dir, "../../src/services/taskflow-cli-bin.ts")],
    },
];

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

/**
 * Every task `<id>` lives in project `project-of-<id>`; `sub-1` is itself a
 * subtask and `missing` does not exist. The create route refuses a subtask
 * parent with the backend's own message.
 */
function startBackend(): Recorded[] {
    void server?.stop(true);
    const requests: Recorded[] = [];
    server = Bun.serve({
        hostname: "127.0.0.1",
        port: 0,
        async fetch(req) {
            const url = new URL(req.url);
            if (url.pathname.endsWith("/owner")) {
                return Response.json({ error: "unknown session" }, { status: 404 });
            }
            const body = await req.text();
            requests.push({ method: req.method, path: url.pathname, body });

            const taskMatch = /^\/api\/tasks\/([^/]+)$/.exec(url.pathname);
            if (req.method === "GET" && taskMatch) {
                const id = decodeURIComponent(taskMatch[1]);
                if (id === "missing") {
                    return Response.json({ error: `Task not found: ${id}` }, { status: 404 });
                }
                return Response.json({
                    task: {
                        id,
                        projectId: `project-of-${id}`,
                        ...(id === "sub-1" ? { parentId: "top-1" } : {}),
                        sessions: [],
                    },
                    resolvedAttributes: [],
                    log: [],
                });
            }
            if (req.method === "POST" && /^\/api\/projects\/[^/]+\/tasks$/.test(url.pathname)) {
                const parsed = JSON.parse(body) as { parentId?: string };
                if (parsed.parentId === "sub-1") {
                    return Response.json(
                        { error: "Cannot create a subtask of a subtask" },
                        { status: 400 },
                    );
                }
                return Response.json({ task: { id: "new-task" } });
            }
            return Response.json({ error: "unexpected request" }, { status: 500 });
        },
    });
    return requests;
}

// Async on purpose: a blocking spawn would stall the in-process server.
async function run(argv: string[], args: string[], env: Record<string, string> = {}) {
    const proc = Bun.spawn([...argv, ...args], {
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

const TASK_CONTEXT = { TASKFLOW_TASK_ID: "task-1", TASKFLOW_PROJECT_ID: "project-1" };

function creates(requests: Recorded[]): { path: string; body: Record<string, unknown> }[] {
    return requests
        .filter((r) => r.method === "POST")
        .map((r) => ({ path: r.path, body: JSON.parse(r.body) as Record<string, unknown> }));
}

for (const impl of IMPLEMENTATIONS) {
    describe(`taskflow-cli task create (${impl.name})`, () => {
        it("creates a top-level task in the current project by default, even in task context", async () => {
            const requests = startBackend();
            const result = await run(impl.argv, ["task", "create", "Do it"], TASK_CONTEXT);

            expect(result.status).toBe(0);
            expect(creates(requests)).toEqual([
                { path: "/api/projects/project-1/tasks", body: { description: "Do it" } },
            ]);
        });

        it("--subtask nests under the current task, in its project", async () => {
            const requests = startBackend();
            const result = await run(
                impl.argv,
                ["task", "create", "Do it", "--subtask"],
                TASK_CONTEXT,
            );

            expect(result.status).toBe(0);
            expect(creates(requests)).toEqual([
                {
                    path: "/api/projects/project-of-task-1/tasks",
                    body: { description: "Do it", parentId: "task-1" },
                },
            ]);
        });

        it("--subtask takes the task from the global --task option", async () => {
            const requests = startBackend();
            const result = await run(impl.argv, [
                "--task",
                "task-7",
                "task",
                "create",
                "Do it",
                "--subtask",
            ]);

            expect(result.status).toBe(0);
            expect(creates(requests)).toEqual([
                {
                    path: "/api/projects/project-of-task-7/tasks",
                    body: { description: "Do it", parentId: "task-7" },
                },
            ]);
        });

        it("--parent nests under the named task, in its project, inside or outside task context", async () => {
            for (const env of [TASK_CONTEXT, {}]) {
                const requests = startBackend();
                const result = await run(
                    impl.argv,
                    ["task", "create", "Do it", "--parent", "other-9", "--title", "T"],
                    env,
                );

                expect(result.status).toBe(0);
                expect(creates(requests)).toEqual([
                    {
                        path: "/api/projects/project-of-other-9/tasks",
                        body: { description: "Do it", title: "T", parentId: "other-9" },
                    },
                ]);
            }
        });

        it("refuses --subtask together with --parent", async () => {
            const requests = startBackend();
            const result = await run(
                impl.argv,
                ["task", "create", "Do it", "--subtask", "--parent", "other-9"],
                TASK_CONTEXT,
            );

            expect(result.status).toBe(1);
            expect(result.stderr).toContain("either --subtask or --parent");
            expect(requests).toEqual([]);
        });

        it("refuses --subtask without a task context", async () => {
            const requests = startBackend();
            const result = await run(impl.argv, ["task", "create", "Do it", "--subtask"], {
                TASKFLOW_PROJECT_ID: "project-1",
            });

            expect(result.status).toBe(1);
            expect(result.stderr).toContain("--subtask needs a task context");
            expect(requests).toEqual([]);
        });

        it("refuses --worktree with either subtask flag", async () => {
            for (const flags of [["--subtask"], ["--parent", "other-9"]]) {
                const requests = startBackend();
                const result = await run(
                    impl.argv,
                    ["task", "create", "Do it", "--worktree", ...flags],
                    TASK_CONTEXT,
                );

                expect(result.status).toBe(1);
                expect(result.stderr).toContain(
                    "--worktree is not allowed when creating a subtask",
                );
                expect(requests).toEqual([]);
            }
        });

        it("passes on the backend's refusal of a subtask parent", async () => {
            startBackend();
            const result = await run(impl.argv, ["task", "create", "Do it", "--parent", "sub-1"]);

            expect(result.status).toBe(1);
            expect(result.stdout + result.stderr).toContain("Cannot create a subtask of a subtask");
        });

        it("reports an unknown parent without creating anything", async () => {
            const requests = startBackend();
            const result = await run(impl.argv, ["task", "create", "Do it", "--parent", "missing"]);

            expect(result.status).toBe(1);
            expect(result.stderr).toContain("Task not found: missing");
            expect(creates(requests)).toEqual([]);
        });
    });
}
