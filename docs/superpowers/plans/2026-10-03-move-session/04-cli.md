# Section 4: CLI owner lookup and `session move`

Read first: the plan index, `handoff.md`, and the spec section "CLI". Section 3 has to be done: it provides `POST /api/sessions/:id/move` and `GET /api/sessions/:id/owner`.

Both implementations change identically:
- `packages/backend/src/services/taskflow-cli.sh` is the POSIX script that runs on macOS/Linux. Agents get it through `ensureCliScript`.
- `packages/backend/src/services/taskflow-cli-bin.ts` is the TS binary used on Windows.

### Task 6: POSIX script

**Files:**
- Modify: `packages/backend/src/services/taskflow-cli.sh`:
  - global flag loop (lines 41-48);
  - a new owner lookup after the `--help` loop (after line 57);
  - hoist `attr_request` (around line 1423) to a top-level `api_request`;
  - a new `session move` (session block, lines 1238-1325).
- Modify: `packages/backend/tests/services/taskflow-cli.test.ts`. Teach the fake curl about `/owner` and `-w`, and add tests.

**Interfaces:**
- Consumes: `GET /api/sessions/:id/owner`, which returns `{"taskId":"…","projectId":"…"}`, `{"projectId":"…"}` or `{"master":true}`, or 404. Also `POST /api/sessions/:id/move` with `{"taskId":…}` | `{"projectId":…}` | `{"master":true}`.
- Produces: `taskflow-cli session move --task <id> | --project <id> | --master [--session <id>]`.

- [ ] **Step 1: Extend the fake curl and write the failing tests**

In `setupCliHarness`, replace the fake curl script with this version. It answers `…/owner` from `$OWNER_RESPONSE` (exit 22, like `curl -f` on a 404, when that is empty) and records the owner URL separately. It also supports `-w` by appending a status line:

```sh
#!/bin/sh
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
    printf '%s\n' "$url" >> "$OWNER_CAPTURE_FILE"
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
if [ -n "$write_status" ]; then printf '\n%s' "${CURL_STATUS:-200}"; fi
```

The script sits inside a JS template literal, so keep the existing escaping (`\\n` in the `printf` lines inside the braces, as today). Add to the returned `env`: `OWNER_CAPTURE_FILE: join(tempDir, "owner-requests.txt")`, `OWNER_RESPONSE: ""`, `CURL_STATUS: "200"`. Return `ownerCaptureFile` from `setupCliHarness` as well.

Add the tests to `describe("taskflow-cli")`:

```ts
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
        expect(await stat(ownerCaptureFile).then(() => true, () => false)).toBe(false);
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd packages/backend && bun test tests/services/taskflow-cli.test.ts`
Expected: the new tests FAIL. There is no lookup, and `session move` prints usage. Every existing test must still PASS with the new fake curl. If one fails, fix the fake curl, not the test.

- [ ] **Step 3: Implement**

a) Global flags. Track whether the caller named an owner:

```sh
# Parse global flags before the command
owner_flag_given=""
while [ $# -gt 0 ]; do
  case "$1" in
    --task) TASKFLOW_TASK_ID="${2:-}"; owner_flag_given=1; shift 2 ;;
    --project-id) TASKFLOW_PROJECT_ID="${2:-}"; owner_flag_given=1; shift 2 ;;
    *) break ;;
  esac
done
```

b) After the `--help` loop and before `cmd="${1:-}"`:

```sh
# A moved session's env still names the owner it started in. Unless the
# caller named one, ask the backend where this session lives now. Any
# failure (headless sessions are unknown to it) keeps the env values.
if [ -z "$owner_flag_given" ] && [ -n "$TASKFLOW_SESSION_ID" ]; then
  if owner_json=$(curl -sf "$TASKFLOW_API_URL/api/sessions/$TASKFLOW_SESSION_ID/owner" 2>/dev/null); then
    TASKFLOW_TASK_ID=$(printf '%s' "$owner_json" | sed -n 's/.*"taskId":"\([^"]*\)".*/\1/p')
    TASKFLOW_PROJECT_ID=$(printf '%s' "$owner_json" | sed -n 's/.*"projectId":"\([^"]*\)".*/\1/p')
  fi
fi
```

c) Hoist `attr_request` to a top-level helper, defined right after `resolve_owner_id`. It is the same body, renamed, with the comment generalised:

```sh
# Unlike `curl -sf` used elsewhere in this script, this prints the API's
# error body. Some writes fail for actionable reasons (duplicate attribute
# name, an unmovable session) and an agent needs to read them.
api_request() {
  req_method="$1"
  req_url="$2"
  req_body="${3:-}"
  if [ -n "$req_body" ]; then
    req_out=$(curl -s -w '\n%{http_code}' -X "$req_method" "$req_url" \
      -H "Content-Type: application/json" -d "$req_body") \
      || { echo "Error: unable to reach $TASKFLOW_API_URL" >&2; exit 1; }
  else
    req_out=$(curl -s -w '\n%{http_code}' -X "$req_method" "$req_url") \
      || { echo "Error: unable to reach $TASKFLOW_API_URL" >&2; exit 1; }
  fi
  req_code=$(printf '%s' "$req_out" | tail -n1)
  printf '%s' "$req_out" | sed '$d'
  case "$req_code" in
    2*) ;;
    *) echo "Error: $req_method $req_url returned $req_code" >&2; exit 1 ;;
  esac
}
```

Delete the old `attr_request` definition and replace its call sites in the attr block with `api_request` (`grep -n attr_request` shows 5 call sites).

d) Add `move` to the session block, before the `*)` usage case, and add `move` to that usage list:

```sh
      move)
        move_body=""
        move_count=0
        move_session="$TASKFLOW_SESSION_ID"
        move_usage="Usage: taskflow-cli session move --task <id> | --project <id> | --master [--session <id>]"
        while [ $# -gt 0 ]; do
          case "$1" in
            --task|--project|--session)
              if [ $# -lt 2 ]; then echo "$move_usage" >&2; exit 1; fi
              case "$1" in
                --task) move_body=$(printf '{"taskId":%s}' "$(json_string "$2")"); move_count=$((move_count + 1)) ;;
                --project) move_body=$(printf '{"projectId":%s}' "$(json_string "$2")"); move_count=$((move_count + 1)) ;;
                --session) move_session="$2" ;;
              esac
              shift 2
              ;;
            --master) move_body='{"master":true}'; move_count=$((move_count + 1)); shift ;;
            *) echo "$move_usage" >&2; exit 1 ;;
          esac
        done
        if [ "$move_count" -ne 1 ] || [ -z "$move_session" ]; then
          echo "$move_usage" >&2
          exit 1
        fi
        api_request POST "$TASKFLOW_API_URL/api/sessions/$move_session/move" "$move_body"
        ;;
```

e) Update the header comment on line 5 to say that `TASKFLOW_TASK_ID` / `TASKFLOW_PROJECT_ID` are replaced by the session's current owner when `TASKFLOW_SESSION_ID` is set.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd packages/backend && bun test tests/services/taskflow-cli.test.ts`
Expected: PASS (old and new).

- [ ] **Step 5: Commit**

```bash
git add packages/backend/src/services/taskflow-cli.sh packages/backend/tests/services/taskflow-cli.test.ts
git commit -m "feat(cli): follow a moved session's owner and add session move (sh)"
```

### Task 7: TS binary and docs

**Files:**
- Modify: `packages/backend/src/services/taskflow-cli-bin.ts`:
  - global flag parse (lines 112-125);
  - `main()` (around line 1337);
  - `handleSession` (lines 1217-1302).
- Create: `packages/backend/tests/services/taskflow-cli-bin-session.test.ts`
- Modify: `packages/backend/src/services/taskflow-cli-session-commands.md`, `packages/backend/src/services/taskflow-cli-task-commands.md` (line 9).

**Interfaces:** the same command and lookup behaviour as Task 6.

- [ ] **Step 1: Write the failing tests**

There is no fake-curl harness for the binary, so the test runs it with `bun` against a real `Bun.serve` that records requests:

```ts
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
                    : Response.json({ error: "Flow sessions cannot be moved" }, { status: moveStatus });
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
            const result = await runBin(["session", "move", ...args], { TASKFLOW_SESSION_ID: "s1" });
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd packages/backend && bun test tests/services/taskflow-cli-bin-session.test.ts`
Expected: FAIL. There is no lookup request, and `session move` prints usage.

- [ ] **Step 3: Implement**

Global flag parse: add `let ownerFlagGiven = false;` next to `let argIndex = 0;`. Set it to `true` in both the `--task` and `--project-id` branches.

Add after `findById`:

```ts
/**
 * A moved session's env still names the owner it started in. Unless the
 * caller named one, ask the backend where this session lives now. Any failure
 * (headless sessions are unknown to it) keeps the env values.
 */
async function adoptSessionOwner(): Promise<void> {
    if (ownerFlagGiven || !sessionId) return;
    try {
        const resp = await fetch(`${API_URL}/api/sessions/${sessionId}/owner`);
        if (!resp.ok) return;
        const owner = (await resp.json()) as SessionOwnerRef;
        taskId = owner.taskId ?? "";
        projectId = owner.projectId ?? "";
    } catch {
        // keep the env values
    }
}
```

Add `SessionOwnerRef` to the existing `import type { … } from "@taskflow/shared";`. In `main()`, after the `--help` early return and before `switch (cmd)`, add `await adoptSessionOwner();`.

In `handleSession`, add before `default:`:

```ts
        case "move": {
            const usage =
                "Usage: taskflow-cli session move --task <id> | --project <id> | --master [--session <id>]\n";
            // consumeFlags keeps only the last of a repeated flag, so count
            // the target flags here to reject `--task a --task b` like the sh CLI.
            const targetFlags = subArgs.filter(
                (arg) => arg === "--task" || arg === "--project" || arg === "--master",
            );
            const { flags, positional, unknown } = consumeFlags(subArgs, {
                task: "string",
                project: "string",
                master: "boolean",
                session: "string",
            });
            const target: SessionOwnerRef | null =
                typeof flags.task === "string"
                    ? { taskId: flags.task }
                    : typeof flags.project === "string"
                      ? { projectId: flags.project }
                      : flags.master === true
                        ? { master: true }
                        : null;
            const sessId = typeof flags.session === "string" ? flags.session : sessionId;
            if (
                targetFlags.length !== 1 ||
                positional.length > 0 ||
                unknown.length > 0 ||
                !target ||
                !sessId
            ) {
                process.stderr.write(usage);
                process.exit(1);
            }
            process.stdout.write(await api("POST", `/api/sessions/${sessId}/move`, { ...target }));
            break;
        }
```

Add `move` to the `default:` usage string.

`api()` already writes `Error: POST … returned 400: {"error":"…"}` to stderr and exits 1, which satisfies the refusal test.

Docs. In `taskflow-cli-session-commands.md`, add after the `close` lines:

```
`taskflow-cli session move --task <taskId>` Move your own session to another task (e.g. one you just created). The process and its working directory stay the same.
`taskflow-cli session move --project <projectId>` Move your own session to a project's level.
`taskflow-cli session move --master` Move your own session to the Master Workspace.
`taskflow-cli session move --task <taskId> --session <sessionId>` Move another session. Only agent sessions can be moved; flow sessions and the remote agent cannot.
After a move, taskflow-cli commands run from inside the session act on its new owner.
```

In `taskflow-cli-task-commands.md` line 9, add one sentence after the first: `Inside a session, the task context is the session's current owner, so it follows a session moved with \`session move\`.`

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd packages/backend && bun test tests/services/taskflow-cli-bin-session.test.ts tests/services/taskflow-cli.test.ts`
Expected: PASS.

- [ ] **Step 5: Full suite, typecheck, lint, format, commit**

```bash
cd packages/backend && bun test && cd ../..
bun run typecheck
bunx eslint packages/backend/src/services/taskflow-cli-bin.ts packages/backend/tests/services/taskflow-cli-bin-session.test.ts packages/backend/tests/services/taskflow-cli.test.ts
bunx prettier --check packages/backend/src/services/taskflow-cli-bin.ts packages/backend/tests/services/taskflow-cli-bin-session.test.ts packages/backend/tests/services/taskflow-cli.test.ts
git add packages/backend/src/services/taskflow-cli-bin.ts packages/backend/tests/services/taskflow-cli-bin-session.test.ts packages/backend/src/services/taskflow-cli-session-commands.md packages/backend/src/services/taskflow-cli-task-commands.md
git commit -m "feat(cli): follow a moved session's owner and add session move (binary, docs)"
```

Update `handoff.md`: Section 4 is done, with the commit hashes.
