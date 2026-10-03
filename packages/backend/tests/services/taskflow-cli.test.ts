import { afterEach, describe, expect, it } from "bun:test";
import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "fs/promises";
import { join, delimiter } from "path";
import { tmpdir } from "os";
import { spawnSync } from "child_process";
import { ensureCliScript } from "../../src/services/internal-agent-skill";

const tempDirs: string[] = [];

afterEach(async () => {
    while (tempDirs.length > 0) {
        const dir = tempDirs.pop();
        if (dir) await rm(dir, { recursive: true, force: true });
    }
});

interface CapturedRequest {
    method: string;
    url: string;
    data: string;
}

async function setupCliHarness(): Promise<{
    cliPath: string;
    captureFile: string;
    ownerCaptureFile: string;
    env: NodeJS.ProcessEnv;
}> {
    const tempDir = await mkdtemp(join(tmpdir(), "taskflow-cli-test-"));
    tempDirs.push(tempDir);

    const cliDir = join(tempDir, "cli");
    const fakeBinDir = join(tempDir, "fake-bin");
    const captureFile = join(tempDir, "curl-request.txt");
    const ownerCaptureFile = join(tempDir, "owner-requests.txt");

    await ensureCliScript(cliDir);
    await mkdir(fakeBinDir, { recursive: true });
    await writeFile(
        join(fakeBinDir, "curl"),
        `#!/bin/sh
set -e
method="GET"
url=""
data=""
write_status=""
while [ $# -gt 0 ]; do
  case "$1" in
    -X)
      method="$2"
      shift 2
      ;;
    -d)
      data="$2"
      shift 2
      ;;
    -H)
      shift 2
      ;;
    -w)
      write_status=1
      shift 2
      ;;
    -s|-f|-sf)
      shift
      ;;
    *)
      url="$1"
      shift
      ;;
  esac
done
case "$url" in
  */owner)
    printf '%s\\n' "$url" >> "$OWNER_CAPTURE_FILE"
    if [ -z "$OWNER_RESPONSE" ]; then exit 22; fi
    printf '%s' "$OWNER_RESPONSE"
    exit 0
    ;;
esac
{
  printf 'METHOD=%s\\n' "$method"
  printf 'URL=%s\\n' "$url"
  printf 'DATA=%s\\n' "$data"
} > "$CAPTURE_FILE"
printf '%s' "$CURL_RESPONSE"
if [ -n "$write_status" ]; then printf '\\n%s' "\${CURL_STATUS:-200}"; fi
`,
        "utf8",
    );
    await chmod(join(fakeBinDir, "curl"), 0o755);

    return {
        cliPath: join(cliDir, "taskflow-cli"),
        captureFile,
        ownerCaptureFile,
        env: {
            ...process.env,
            PATH: `${fakeBinDir}${delimiter}${process.env.PATH ?? ""}`,
            CAPTURE_FILE: captureFile,
            OWNER_CAPTURE_FILE: ownerCaptureFile,
            OWNER_RESPONSE: "",
            CURL_STATUS: "200",
            TASKFLOW_API_URL: "http://localhost:1234",
            CURL_RESPONSE: "{}",
            TASKFLOW_TASK_ID: "",
            TASKFLOW_PROJECT_ID: "",
            TASKFLOW_FLOW_ID: "",
            TASKFLOW_ACTION_ENTRY_ID: "",
            TASKFLOW_SESSION_ID: "",
        },
    };
}

function runCli(
    cliPath: string,
    args: string[],
    env: NodeJS.ProcessEnv,
): ReturnType<typeof spawnSync> {
    return spawnSync(cliPath, args, {
        env,
        encoding: "utf8",
    });
}

async function readCapturedRequest(captureFile: string): Promise<CapturedRequest> {
    const raw = await readFile(captureFile, "utf8");
    const entries = new Map<string, string>();
    for (const line of raw.trim().split("\n")) {
        const index = line.indexOf("=");
        entries.set(line.slice(0, index), line.slice(index + 1));
    }
    return {
        method: entries.get("METHOD") ?? "",
        url: entries.get("URL") ?? "",
        data: entries.get("DATA") ?? "",
    };
}

describe("taskflow-cli", () => {
    it("routes task reads through the current task context", async () => {
        const { cliPath, captureFile, env } = await setupCliHarness();
        const result = runCli(cliPath, ["task"], {
            ...env,
            TASKFLOW_TASK_ID: "task-1",
            CURL_RESPONSE: '{"id":"task-1"}',
        });

        expect(result.status).toBe(0);
        expect(result.stdout).toBe('{"id":"task-1"}');
        const fileStat = await stat(captureFile);
        expect(fileStat).toBeTruthy();

        expect(await readCapturedRequest(captureFile)).toEqual({
            method: "GET",
            url: "http://localhost:1234/api/tasks/task-1",
            data: "",
        });
    });

    it("creates tasks with explicit project scope and optional fields", async () => {
        const { cliPath, captureFile, env } = await setupCliHarness();
        const result = runCli(
            cliPath,
            [
                "--project-id",
                "project-1",
                "task",
                "create",
                "Investigate flaky build",
                "--title",
                "Flaky build",
                "--worktree",
                "--init",
                "bun test",
            ],
            env,
        );

        expect(result.status).toBe(0);

        const request = await readCapturedRequest(captureFile);
        expect(request.method).toBe("POST");
        expect(request.url).toBe("http://localhost:1234/api/projects/project-1/tasks");
        expect(JSON.parse(request.data)).toEqual({
            description: "Investigate flaky build",
            title: "Flaky build",
            worktree: true,
            initCommand: "bun test",
        });
    });

    it("posts task logs with session and commit metadata", async () => {
        const { cliPath, captureFile, env } = await setupCliHarness();
        const result = runCli(cliPath, ["log", "commit", "Created fix", "--hash", "abc123"], {
            ...env,
            TASKFLOW_TASK_ID: "task-1",
            TASKFLOW_SESSION_ID: "session-1",
        });

        expect(result.status).toBe(0);

        const request = await readCapturedRequest(captureFile);
        expect(request.method).toBe("POST");
        expect(request.url).toBe("http://localhost:1234/api/tasks/task-1/log");
        expect(JSON.parse(request.data)).toEqual({
            type: "commit",
            message: "Created fix",
            sessionId: "session-1",
            meta: { hash: "abc123" },
        });
    });

    it("opens project browser tabs on the project endpoint", async () => {
        const { cliPath, captureFile, env } = await setupCliHarness();
        const result = runCli(
            cliPath,
            ["browser", "https://example.com/docs", "--label", "Docs", "--project"],
            {
                ...env,
                TASKFLOW_PROJECT_ID: "project-1",
            },
        );

        expect(result.status).toBe(0);

        const request = await readCapturedRequest(captureFile);
        expect(request.method).toBe("POST");
        expect(request.url).toBe("http://localhost:1234/api/projects/project-1/browser");
        expect(JSON.parse(request.data)).toEqual({
            url: "https://example.com/docs",
            label: "Docs",
        });
    });

    it("sends session input with joined message parts and raw mode", async () => {
        const { cliPath, captureFile, env } = await setupCliHarness();
        const result = runCli(
            cliPath,
            ["session", "input", "session-1", "hello", "from", "cli", "--raw"],
            env,
        );

        expect(result.status).toBe(0);

        const request = await readCapturedRequest(captureFile);
        expect(request.method).toBe("POST");
        expect(request.url).toBe("http://localhost:1234/api/sessions/session-1/input");
        expect(JSON.parse(request.data)).toEqual({
            data: "hello from cli",
            raw: true,
        });
    });

    it("maps Claude's legacy dangerous flag to the canonical bypass permission mode", async () => {
        const { cliPath, captureFile, env } = await setupCliHarness();
        const result = runCli(
            cliPath,
            ["agent", "run", "claude", "--dangerously-skip-permissions", "--effort", "ultracode"],
            { ...env, TASKFLOW_PROJECT_ID: "project-1" },
        );

        expect(result.status).toBe(0);
        const request = await readCapturedRequest(captureFile);
        expect(JSON.parse(request.data)).toMatchObject({
            projectId: "project-1",
            type: "claude",
            agentOptions: {
                type: "claude",
                permissionMode: "bypassPermissions",
                effort: "ultracode",
            },
        });
    });

    it("lets an explicit Claude permission mode override the legacy dangerous alias", async () => {
        const { cliPath, captureFile, env } = await setupCliHarness();
        const result = runCli(
            cliPath,
            [
                "agent",
                "run",
                "claude",
                "--dangerously-skip-permissions",
                "--permission-mode",
                "manual",
            ],
            { ...env, TASKFLOW_PROJECT_ID: "project-1" },
        );

        expect(result.status).toBe(0);
        const request = await readCapturedRequest(captureFile);
        const body = JSON.parse(request.data) as {
            agentOptions: { permissionMode?: unknown };
        };
        expect(body.agentOptions.permissionMode).toBe("manual");
    });

    it("passes --account into Claude and Codex agent options", async () => {
        const { cliPath, captureFile, env } = await setupCliHarness();
        const result = runCli(cliPath, ["agent", "run", "codex", "--account", "work"], {
            ...env,
            TASKFLOW_PROJECT_ID: "project-1",
        });
        expect(result.status).toBe(0);
        const request = await readCapturedRequest(captureFile);
        expect(JSON.parse(request.data)).toMatchObject({
            agentOptions: { type: "codex", account: "work" },
        });
    });

    it("ignores --account for agents without accounts", async () => {
        const { cliPath, captureFile, env } = await setupCliHarness();
        runCli(cliPath, ["agent", "run", "pi", "--account", "work"], {
            ...env,
            TASKFLOW_PROJECT_ID: "project-1",
        });
        const request = await readCapturedRequest(captureFile);
        const body = JSON.parse(request.data) as {
            agentOptions?: { account?: unknown };
        };
        expect(body.agentOptions?.account).toBeUndefined();
    });

    it("maps project account flags, with inherit clearing", async () => {
        const { cliPath, captureFile, env } = await setupCliHarness();
        const result = runCli(
            cliPath,
            ["project", "update", "p1", "--claude-account", "work", "--codex-account", "inherit"],
            env,
        );
        expect(result.status).toBe(0);
        const request = await readCapturedRequest(captureFile);
        expect(request.method).toBe("PATCH");
        expect(JSON.parse(request.data)).toEqual({
            agentAccounts: { claude: "work", codex: null },
        });
    });

    it("ends the whole flow from a flow action", async () => {
        const { cliPath, captureFile, env } = await setupCliHarness();
        const result = runCli(cliPath, ["flow", "complete"], {
            ...env,
            TASKFLOW_TASK_ID: "task-1",
            TASKFLOW_FLOW_ID: "flow-1",
            TASKFLOW_SESSION_ID: "session-1",
        });

        expect(result.status).toBe(0);
        const request = await readCapturedRequest(captureFile);
        expect(request.method).toBe("POST");
        expect(request.url).toBe("http://localhost:1234/api/flow/complete");
        expect(JSON.parse(request.data)).toEqual({
            taskId: "task-1",
            flowId: "flow-1",
            sessionId: "session-1",
        });
    });

    it("refuses flow complete outside a flow action", async () => {
        const { cliPath, env } = await setupCliHarness();
        const result = runCli(cliPath, ["flow", "complete"], {
            ...env,
            TASKFLOW_TASK_ID: "task-1",
        });

        expect(result.status).toBe(1);
        expect(result.stderr).toContain("TASKFLOW_FLOW_ID is not set");
    });

    it("refuses flow complete when the session id is missing", async () => {
        const { cliPath, env } = await setupCliHarness();
        const result = runCli(cliPath, ["flow", "complete"], {
            ...env,
            TASKFLOW_TASK_ID: "task-1",
            TASKFLOW_FLOW_ID: "flow-1",
        });

        expect(result.status).toBe(1);
        expect(result.stderr).toContain("TASKFLOW_SESSION_ID is not set");
    });

    it("sets loop on flow create", async () => {
        const { cliPath, captureFile, env } = await setupCliHarness();

        // Include --action so the payload is a flow a real backend would accept —
        // flow-store.ts:13 rejects a definition with no actions.
        const result = runCli(
            cliPath,
            ["flow", "create", "--name", "Looper", "--action", "action-1", "--loop"],
            { ...env, TASKFLOW_PROJECT_ID: "project-1" },
        );

        expect(result.status).toBe(0);
        const body = JSON.parse((await readCapturedRequest(captureFile)).data) as {
            loop?: unknown;
        };
        expect(body.loop).toBe(true);
    });

    it("omits loop from flow create when neither flag is given", async () => {
        const { cliPath, captureFile, env } = await setupCliHarness();
        const result = runCli(
            cliPath,
            ["flow", "create", "--name", "Plain", "--action", "action-1"],
            {
                ...env,
                TASKFLOW_PROJECT_ID: "project-1",
            },
        );

        expect(result.status).toBe(0);
        expect(JSON.parse((await readCapturedRequest(captureFile)).data)).not.toHaveProperty(
            "loop",
        );
    });

    it("sets loop false on flow create with --no-loop", async () => {
        const { cliPath, captureFile, env } = await setupCliHarness();
        const result = runCli(
            cliPath,
            ["flow", "create", "--name", "Plain", "--action", "action-1", "--no-loop"],
            { ...env, TASKFLOW_PROJECT_ID: "project-1" },
        );

        expect(result.status).toBe(0);
        const body = JSON.parse((await readCapturedRequest(captureFile)).data) as {
            loop?: unknown;
        };
        expect(body.loop).toBe(false);
    });

    it("rejects --loop and --no-loop together", async () => {
        const { cliPath, env } = await setupCliHarness();
        const result = runCli(
            cliPath,
            ["flow", "create", "--name", "X", "--action", "action-1", "--loop", "--no-loop"],
            env,
        );

        expect(result.status).toBe(1);
        expect(result.stderr).toContain("mutually exclusive");
    });

    it("rejects --no-loop and --loop together regardless of order", async () => {
        const { cliPath, env } = await setupCliHarness();
        const result = runCli(
            cliPath,
            ["flow", "create", "--name", "X", "--action", "action-1", "--no-loop", "--loop"],
            env,
        );

        expect(result.status).toBe(1);
        expect(result.stderr).toContain("mutually exclusive");
    });

    it("fails before issuing requests when task scope is missing", async () => {
        const { cliPath, captureFile, env } = await setupCliHarness();
        const result = runCli(cliPath, ["task"], env);

        expect(result.status).toBe(1);
        expect(result.stderr).toContain("TASKFLOW_TASK_ID is not set");
        let threw = false;
        try {
            await stat(captureFile);
        } catch {
            threw = true;
        }
        expect(threw).toBe(true);
    });
    it("acts on the session's current owner instead of the stale env task", async () => {
        const { cliPath, captureFile, ownerCaptureFile, env } = await setupCliHarness();
        const result = runCli(cliPath, ["task"], {
            ...env,
            TASKFLOW_TASK_ID: "old-task",
            TASKFLOW_PROJECT_ID: "p1",
            TASKFLOW_SESSION_ID: "s1",
            OWNER_RESPONSE: '{"taskId":"new-task","projectId":"p1"}',
        });

        expect(result.status).toBe(0);
        expect(await readFile(ownerCaptureFile, "utf8")).toBe(
            "http://localhost:1234/api/sessions/s1/owner\n",
        );
        expect((await readCapturedRequest(captureFile)).url).toBe(
            "http://localhost:1234/api/tasks/new-task",
        );
    });

    it("drops the env task when the session moved to project level", async () => {
        const { cliPath, env } = await setupCliHarness();
        const result = runCli(cliPath, ["log", "info", "hello"], {
            ...env,
            TASKFLOW_TASK_ID: "old-task",
            TASKFLOW_PROJECT_ID: "p1",
            TASKFLOW_SESSION_ID: "s1",
            OWNER_RESPONSE: '{"projectId":"p2"}',
        });

        // `log` is task-only: with the stale task id dropped it must refuse
        // rather than write to the task the session left.
        expect(result.status).toBe(1);
        expect(String(result.stderr)).toContain("TASKFLOW_TASK_ID is not set");
    });

    it("keeps the env owner when the lookup fails", async () => {
        const { cliPath, captureFile, env } = await setupCliHarness();
        const result = runCli(cliPath, ["task"], {
            ...env,
            TASKFLOW_TASK_ID: "task-1",
            TASKFLOW_SESSION_ID: "s1",
        });

        expect(result.status).toBe(0);
        expect((await readCapturedRequest(captureFile)).url).toBe(
            "http://localhost:1234/api/tasks/task-1",
        );
    });

    it("skips the lookup when the caller names the task", async () => {
        const { cliPath, captureFile, ownerCaptureFile, env } = await setupCliHarness();
        const result = runCli(cliPath, ["--task", "explicit", "task"], {
            ...env,
            TASKFLOW_SESSION_ID: "s1",
            OWNER_RESPONSE: '{"taskId":"other"}',
        });

        expect(result.status).toBe(0);
        expect(
            await stat(ownerCaptureFile).then(
                () => true,
                () => false,
            ),
        ).toBe(false);
        expect((await readCapturedRequest(captureFile)).url).toBe(
            "http://localhost:1234/api/tasks/explicit",
        );
    });

    it("moves the caller's own session to a task, project or master", async () => {
        const { cliPath, captureFile, env } = await setupCliHarness();
        const cases: Array<[string[], string]> = [
            [["--task", "t2"], '{"taskId":"t2"}'],
            [["--project", "p2"], '{"projectId":"p2"}'],
            [["--master"], '{"master":true}'],
        ];
        for (const [flags, body] of cases) {
            const result = runCli(cliPath, ["session", "move", ...flags], {
                ...env,
                TASKFLOW_SESSION_ID: "s1",
                CURL_RESPONSE: '{"success":true}',
            });
            expect(result.status).toBe(0);
            expect(await readCapturedRequest(captureFile)).toEqual({
                method: "POST",
                url: "http://localhost:1234/api/sessions/s1/move",
                data: body,
            });
        }
    });

    it("moves another session with --session", async () => {
        const { cliPath, captureFile, env } = await setupCliHarness();
        const result = runCli(cliPath, ["session", "move", "--task", "t2", "--session", "s9"], {
            ...env,
            CURL_RESPONSE: '{"success":true}',
        });

        expect(result.status).toBe(0);
        expect((await readCapturedRequest(captureFile)).url).toBe(
            "http://localhost:1234/api/sessions/s9/move",
        );
    });

    it("rejects zero or several move targets", async () => {
        const { cliPath, env } = await setupCliHarness();
        const none = runCli(cliPath, ["session", "move"], { ...env, TASKFLOW_SESSION_ID: "s1" });
        const two = runCli(cliPath, ["session", "move", "--task", "t", "--master"], {
            ...env,
            TASKFLOW_SESSION_ID: "s1",
        });
        const repeated = runCli(cliPath, ["session", "move", "--task", "t", "--task", "u"], {
            ...env,
            TASKFLOW_SESSION_ID: "s1",
        });
        const stray = runCli(cliPath, ["session", "move", "t2"], {
            ...env,
            TASKFLOW_SESSION_ID: "s1",
        });

        expect(none.status).toBe(1);
        expect(two.status).toBe(1);
        expect(repeated.status).toBe(1);
        expect(stray.status).toBe(1);
        expect(String(two.stderr)).toContain("Usage: taskflow-cli session move");
    });

    it("prints the backend's refusal and exits non-zero", async () => {
        const { cliPath, env } = await setupCliHarness();
        const result = runCli(cliPath, ["session", "move", "--task", "t2"], {
            ...env,
            TASKFLOW_SESSION_ID: "s1",
            CURL_RESPONSE: '{"error":"Flow sessions cannot be moved"}',
            CURL_STATUS: "400",
        });

        expect(result.status).toBe(1);
        expect(String(result.stdout)).toContain("Flow sessions cannot be moved");
    });
});
