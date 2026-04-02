import { afterEach, describe, expect, it } from "bun:test";
import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "fs/promises";
import { join } from "path";
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
    env: NodeJS.ProcessEnv;
}> {
    const tempDir = await mkdtemp(join(tmpdir(), "taskflow-cli-test-"));
    tempDirs.push(tempDir);

    const cliDir = join(tempDir, "cli");
    const fakeBinDir = join(tempDir, "fake-bin");
    const captureFile = join(tempDir, "curl-request.txt");

    await ensureCliScript(cliDir);
    await mkdir(fakeBinDir, { recursive: true });
    await writeFile(
        join(fakeBinDir, "curl"),
        `#!/bin/sh
set -e
method="GET"
url=""
data=""
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
    -s|-f)
      shift
      ;;
    *)
      url="$1"
      shift
      ;;
  esac
done
{
  printf 'METHOD=%s\\n' "$method"
  printf 'URL=%s\\n' "$url"
  printf 'DATA=%s\\n' "$data"
} > "$CAPTURE_FILE"
printf '%s' "$CURL_RESPONSE"
`,
        "utf8",
    );
    await chmod(join(fakeBinDir, "curl"), 0o755);

    return {
        cliPath: join(cliDir, "taskflow-cli"),
        captureFile,
        env: {
            ...process.env,
            PATH: `${fakeBinDir}:${process.env.PATH ?? ""}`,
            CAPTURE_FILE: captureFile,
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
        await expect(stat(captureFile)).resolves.toBeTruthy();

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
        const result = runCli(
            cliPath,
            ["log", "commit", "Created fix", "--hash", "abc123"],
            {
                ...env,
                TASKFLOW_TASK_ID: "task-1",
                TASKFLOW_SESSION_ID: "session-1",
            },
        );

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

    it("fails before issuing requests when task scope is missing", async () => {
        const { cliPath, captureFile, env } = await setupCliHarness();
        const result = runCli(cliPath, ["task"], env);

        expect(result.status).toBe(1);
        expect(result.stderr).toContain("TASKFLOW_TASK_ID is not set");
        await expect(stat(captureFile)).rejects.toThrow();
    });
});
