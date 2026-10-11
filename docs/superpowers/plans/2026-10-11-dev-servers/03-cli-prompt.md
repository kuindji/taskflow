# Section 3: CLI `devserver` group, command doc, prompt paragraph

Before starting, read the plan index (in particular "Cross-section interfaces" → HTTP, and "Global Constraints"), `handoff.md`, and the spec sections "CLI" and "Agent prompt". The tests below run against a fake curl and a fake server, so this section doesn't need Section 2's routes in order to pass. Section 5's manual check exercises the commands against the real backend.

Both CLI implementations change identically:
- `packages/backend/src/services/taskflow-cli.sh` is the POSIX script that runs on macOS/Linux. Agents get it through `ensureCliScript`.
- `packages/backend/src/services/taskflow-cli-bin.ts` is the TS binary used on Windows.

**Command shape (both implementations):**

```
taskflow-cli devserver add --pid <pid> --label "<label>"
taskflow-cli devserver list [--all]
taskflow-cli devserver remove <id>
taskflow-cli devserver remove --pid <pid>
```

**Rules (both implementations):**
- `--pid` must be all digits, and leading zeros are stripped before sending. Anything else is a usage error and no request is sent. The backend still rejects `0` with `Field 'pid' must be a positive integer`.
- `add` requires both `--pid` and a non-empty `--label`.
- `remove` takes exactly one of `<id>` or `--pid <pid>`.
- Any unknown flag or stray positional is a usage error, exit 1.
- **Project context:** `TASKFLOW_PROJECT_ID` is required for `add`, `list` (without `--all`) and `remove`. If it's missing, print `Error: TASKFLOW_PROJECT_ID is not set` and exit 1 before any request. `list --all` needs no context.
- **Headers:** requests carry `X-Taskflow-Project-Id`, `X-Taskflow-Task-Id` and `X-Taskflow-Session-Id` for whichever of the three ids is set. `list --all` sends them too, whichever are set, in both implementations; the backend ignores headers when `all=1`.
- **Repeated `--pid` in `remove`** is a usage error in both implementations. The TS parser keeps only the last value of a repeated flag, so the bin counts `--pid` occurrences, as `session move` already does for its target flags.
- **Errors:** every request goes through the helper that prints the backend's error body: `api_request` in sh, `api()` in TS. That way `{"error":"Field 'label' must be at most 80 characters"}` and similar messages reach the agent, with exit 1.
- **Output:** the backend's JSON body, printed as-is.

### Task 1: POSIX script

**Files:**
- Modify: `packages/backend/src/services/taskflow-cli.sh`:
  - `api_request` (lines 41-61), which now also sends the context headers;
  - a new top-level `devserver)` case, placed right after the `notify)` case (which ends around line 894).
- Modify: `packages/backend/tests/services/taskflow-cli.test.ts`. The fake curl records `-H` values; add a `readCapturedHeaders` helper and the new tests.

**Interfaces:**
- Consumes the HTTP API from the plan index:
  - `POST /api/dev-servers`, body `{"pid":<number>,"label":"<string>"}`;
  - `GET /api/dev-servers`;
  - `GET /api/dev-servers?all=1`;
  - `DELETE /api/dev-servers/<id>`;
  - `DELETE /api/dev-servers?pid=<pid>`.
- Produces: the `taskflow-cli devserver add|list|remove` commands above.

- [ ] **Step 1: Teach the fake curl to record headers, and write the failing tests**

In `setupCliHarness`, change the fake curl script in three places. Keep the template-literal escaping as it is: `\\n` inside the `printf` lines.

1. Initialise `headers=""` next to `write_status=""`.
2. Replace the `-H)` branch with:

```sh
    -H)
      headers="$headers$2|"
      shift 2
      ;;
```

3. In the block that writes `$CAPTURE_FILE`, add a fourth line after the `DATA=` line:

```sh
  printf 'HEADERS=%s\\n' "$headers"
```

`readCapturedRequest` keys its map by line prefix and only reads `METHOD`, `URL` and `DATA`, so every existing `toEqual` assertion stays valid. Add this helper below `readCapturedRequest`:

```ts
async function readCapturedHeaders(captureFile: string): Promise<string[]> {
    const raw = await readFile(captureFile, "utf8");
    const line = raw.split("\n").find((entry) => entry.startsWith("HEADERS=")) ?? "HEADERS=";
    return line.slice("HEADERS=".length).split("|").filter(Boolean);
}

async function captured(captureFile: string): Promise<boolean> {
    return stat(captureFile).then(
        () => true,
        () => false,
    );
}
```

Add these tests at the end of `describe("taskflow-cli")`:

```ts
    describe("devserver", () => {
        const owner = {
            TASKFLOW_PROJECT_ID: "p1",
            TASKFLOW_TASK_ID: "t1",
            TASKFLOW_SESSION_ID: "s1",
        };

        it("registers a dev server with the caller's owner headers", async () => {
            const { cliPath, captureFile, env } = await setupCliHarness();
            const result = runCli(
                cliPath,
                ["devserver", "add", "--pid", "4821", "--label", "UI dev server :5173"],
                { ...env, ...owner, CURL_RESPONSE: '{"id":"d1"}', CURL_STATUS: "201" },
            );

            expect(result.status).toBe(0);
            expect(String(result.stdout)).toContain('"id":"d1"');
            expect(await readCapturedRequest(captureFile)).toEqual({
                method: "POST",
                url: "http://localhost:1234/api/dev-servers",
                data: '{"pid":4821,"label":"UI dev server :5173"}',
            });
            const headers = await readCapturedHeaders(captureFile);
            expect(headers).toContain("X-Taskflow-Project-Id: p1");
            expect(headers).toContain("X-Taskflow-Task-Id: t1");
            expect(headers).toContain("X-Taskflow-Session-Id: s1");
        });

        it("omits the task header for a project-level session", async () => {
            const { cliPath, captureFile, env } = await setupCliHarness();
            const result = runCli(cliPath, ["devserver", "add", "--pid", "7", "--label", "api"], {
                ...env,
                TASKFLOW_PROJECT_ID: "p1",
            });

            expect(result.status).toBe(0);
            const headers = await readCapturedHeaders(captureFile);
            expect(headers).toContain("X-Taskflow-Project-Id: p1");
            expect(headers.some((h) => h.startsWith("X-Taskflow-Task-Id"))).toBe(false);
        });

        it("strips leading zeros from the pid and escapes the label", async () => {
            const { cliPath, captureFile, env } = await setupCliHarness();
            const result = runCli(
                cliPath,
                ["devserver", "add", "--pid", "007", "--label", 'Say "hi" :3000'],
                { ...env, ...owner },
            );

            expect(result.status).toBe(0);
            expect((await readCapturedRequest(captureFile)).data).toBe(
                '{"pid":7,"label":"Say \\"hi\\" :3000"}',
            );
        });

        it("refuses add without a numeric --pid and a --label, before any request", async () => {
            const { cliPath, captureFile, env } = await setupCliHarness();
            for (const args of [
                ["--label", "x"],
                ["--pid", "1"],
                ["--pid", "abc", "--label", "x"],
                ["--pid", "-5", "--label", "x"],
                ["--pid", "1", "--label", ""],
                ["--pid", "1", "--label", "x", "stray"],
                ["--pid", "1", "--label", "x", "--port", "3000"],
                ["--pid"],
                ["--pid", "1", "--label", "x", "-x"],
                ["--pid", "1", "--label", "x", "--"],
                ["--", "--pid", "1", "--label", "x"],
            ]) {
                const result = runCli(cliPath, ["devserver", "add", ...args], { ...env, ...owner });
                expect(result.status).toBe(1);
                expect(String(result.stderr)).toContain("Usage: taskflow-cli devserver add");
            }
            expect(await captured(captureFile)).toBe(false);
        });

        it("takes `--` as a flag's value, not as end-of-flags", async () => {
            const { cliPath, captureFile, env } = await setupCliHarness();
            const result = runCli(cliPath, ["devserver", "add", "--pid", "1", "--label", "--"], {
                ...env,
                ...owner,
                CURL_RESPONSE: '{"id":"d1"}',
                CURL_STATUS: "201",
            });

            expect(result.status).toBe(0);
            expect((await readCapturedRequest(captureFile)).data).toBe('{"pid":1,"label":"--"}');
        });

        it("refuses add, list and remove without project context", async () => {
            const { cliPath, captureFile, env } = await setupCliHarness();
            for (const args of [
                ["add", "--pid", "1", "--label", "x"],
                ["list"],
                ["remove", "d1"],
                ["remove", "--pid", "1"],
            ]) {
                const result = runCli(cliPath, ["devserver", ...args], env);
                expect(result.status).toBe(1);
                expect(String(result.stderr)).toContain("TASKFLOW_PROJECT_ID is not set");
            }
            expect(await captured(captureFile)).toBe(false);
        });

        it("prints the backend's validation error and exits non-zero", async () => {
            const { cliPath, env } = await setupCliHarness();
            const result = runCli(cliPath, ["devserver", "add", "--pid", "1", "--label", "x"], {
                ...env,
                ...owner,
                CURL_RESPONSE: `{"error":"Field 'label' must be at most 80 characters"}`,
                CURL_STATUS: "400",
            });

            expect(result.status).toBe(1);
            expect(String(result.stdout)).toContain("Field 'label' must be at most 80 characters");
        });

        it("lists the caller's dev servers, or all of them with --all", async () => {
            const { cliPath, captureFile, env } = await setupCliHarness();

            const own = runCli(cliPath, ["devserver", "list"], { ...env, ...owner });
            expect(own.status).toBe(0);
            expect(await readCapturedRequest(captureFile)).toEqual({
                method: "GET",
                url: "http://localhost:1234/api/dev-servers",
                data: "",
            });
            expect(await readCapturedHeaders(captureFile)).toContain("X-Taskflow-Project-Id: p1");

            // --all needs no context at all.
            const all = runCli(cliPath, ["devserver", "list", "--all"], env);
            expect(all.status).toBe(0);
            expect((await readCapturedRequest(captureFile)).url).toBe(
                "http://localhost:1234/api/dev-servers?all=1",
            );

            for (const args of [["--mine"], ["-x"], ["--"]]) {
                const stray = runCli(cliPath, ["devserver", "list", ...args], { ...env, ...owner });
                expect(stray.status).toBe(1);
                expect(String(stray.stderr)).toContain("Usage: taskflow-cli devserver list");
            }
        });

        it("removes by id or by pid", async () => {
            const { cliPath, captureFile, env } = await setupCliHarness();

            const byId = runCli(cliPath, ["devserver", "remove", "d1"], { ...env, ...owner });
            expect(byId.status).toBe(0);
            expect(await readCapturedRequest(captureFile)).toEqual({
                method: "DELETE",
                url: "http://localhost:1234/api/dev-servers/d1",
                data: "",
            });

            const byPid = runCli(cliPath, ["devserver", "remove", "--pid", "04821"], {
                ...env,
                ...owner,
            });
            expect(byPid.status).toBe(0);
            expect((await readCapturedRequest(captureFile)).url).toBe(
                "http://localhost:1234/api/dev-servers?pid=4821",
            );
        });

        it("refuses remove without exactly one of <id> or --pid", async () => {
            const { cliPath, captureFile, env } = await setupCliHarness();
            for (const args of [
                [],
                ["d1", "d2"],
                ["d1", "--pid", "5"],
                ["--pid", "5", "--pid", "6"],
                ["--pid", "x"],
                ["--pid", ""],
                ["--pid"],
                ["--all"],
                ["-x"],
                ["--", "d1"],
                ["d1", "--"],
            ]) {
                const result = runCli(cliPath, ["devserver", "remove", ...args], {
                    ...env,
                    ...owner,
                });
                expect(result.status).toBe(1);
                expect(String(result.stderr)).toContain("Usage: taskflow-cli devserver remove");
            }
            expect(await captured(captureFile)).toBe(false);
        });

        it("prints the backend's 404 for an unknown record", async () => {
            const { cliPath, env } = await setupCliHarness();
            const result = runCli(cliPath, ["devserver", "remove", "nope"], {
                ...env,
                ...owner,
                CURL_RESPONSE: '{"error":"Dev server not found"}',
                CURL_STATUS: "404",
            });

            expect(result.status).toBe(1);
            expect(String(result.stdout)).toContain("Dev server not found");
        });

        it("prints usage for an unknown subcommand", async () => {
            const { cliPath, env } = await setupCliHarness();
            const result = runCli(cliPath, ["devserver", "stop", "d1"], { ...env, ...owner });

            expect(result.status).toBe(1);
            expect(String(result.stderr)).toContain("Usage: taskflow-cli devserver <add|list|remove>");
        });
    });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd packages/backend && bun test tests/services/taskflow-cli.test.ts`
Expected: the new `devserver` tests FAIL. The script has no `devserver` case and falls through to printing `/api/cli-help`. Every existing test must still PASS with the header-recording fake curl. If one fails, fix the fake curl, not the test.

- [ ] **Step 3: Implement**

a) Make `api_request` send the context headers. `notify` already uses the `${VAR:+-H "…"}` pattern, and routes that don't read the headers ignore them. Replace the helper and its comment with:

```sh
# Unlike `curl -sf` used elsewhere in this script, this prints the API's
# error body. Some writes fail for actionable reasons (duplicate attribute
# name, an unmovable session, an invalid dev server) and an agent needs to
# read them. It also sends the caller's context headers, which routes that
# act on "the caller's owner" read and every other route ignores.
api_request() {
  req_method="$1"
  req_url="$2"
  req_body="${3:-}"
  if [ -n "$req_body" ]; then
    req_out=$(curl -s -w '\n%{http_code}' -X "$req_method" "$req_url" \
      ${TASKFLOW_PROJECT_ID:+-H "X-Taskflow-Project-Id: $TASKFLOW_PROJECT_ID"} \
      ${TASKFLOW_TASK_ID:+-H "X-Taskflow-Task-Id: $TASKFLOW_TASK_ID"} \
      ${TASKFLOW_SESSION_ID:+-H "X-Taskflow-Session-Id: $TASKFLOW_SESSION_ID"} \
      -H "Content-Type: application/json" -d "$req_body") \
      || { echo "Error: unable to reach $TASKFLOW_API_URL" >&2; exit 1; }
  else
    req_out=$(curl -s -w '\n%{http_code}' -X "$req_method" "$req_url" \
      ${TASKFLOW_PROJECT_ID:+-H "X-Taskflow-Project-Id: $TASKFLOW_PROJECT_ID"} \
      ${TASKFLOW_TASK_ID:+-H "X-Taskflow-Task-Id: $TASKFLOW_TASK_ID"} \
      ${TASKFLOW_SESSION_ID:+-H "X-Taskflow-Session-Id: $TASKFLOW_SESSION_ID"}) \
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

b) Add the `devserver)` case right after the `notify)` case (before `project)`):

```sh
  devserver)
    subcmd="${1:-}"
    shift 2>/dev/null || true
    case "$subcmd" in
      add)
        ds_pid=""
        ds_label=""
        ds_usage='Usage: taskflow-cli devserver add --pid <pid> --label "<label>"'
        while [ $# -gt 0 ]; do
          case "$1" in
            --pid|--label)
              if [ $# -lt 2 ]; then echo "$ds_usage" >&2; exit 1; fi
              case "$1" in
                --pid) ds_pid="$2" ;;
                --label) ds_label="$2" ;;
              esac
              shift 2
              ;;
            *) echo "$ds_usage" >&2; exit 1 ;;
          esac
        done
        case "$ds_pid" in
          ''|*[!0-9]*) echo "$ds_usage" >&2; exit 1 ;;
        esac
        if [ -z "$ds_label" ]; then echo "$ds_usage" >&2; exit 1; fi
        if [ -z "$TASKFLOW_PROJECT_ID" ]; then
          echo "Error: TASKFLOW_PROJECT_ID is not set" >&2
          exit 1
        fi
        # "007" is not valid JSON; send 7.
        ds_pid=$(printf '%s' "$ds_pid" | sed 's/^0*\([0-9]\)/\1/')
        api_request POST "$TASKFLOW_API_URL/api/dev-servers" \
          "$(printf '{"pid":%s,"label":%s}' "$ds_pid" "$(json_string "$ds_label")")"
        ;;
      list)
        ds_all=""
        while [ $# -gt 0 ]; do
          case "$1" in
            --all) ds_all=1; shift ;;
            *) echo "Usage: taskflow-cli devserver list [--all]" >&2; exit 1 ;;
          esac
        done
        if [ -n "$ds_all" ]; then
          api_request GET "$TASKFLOW_API_URL/api/dev-servers?all=1"
        else
          if [ -z "$TASKFLOW_PROJECT_ID" ]; then
            echo "Error: TASKFLOW_PROJECT_ID is not set" >&2
            exit 1
          fi
          api_request GET "$TASKFLOW_API_URL/api/dev-servers"
        fi
        ;;
      remove)
        ds_id=""
        ds_pid=""
        ds_by_pid=""
        ds_given=0
        ds_usage="Usage: taskflow-cli devserver remove <id> | --pid <pid>"
        while [ $# -gt 0 ]; do
          case "$1" in
            --pid)
              if [ $# -lt 2 ]; then echo "$ds_usage" >&2; exit 1; fi
              ds_pid="$2"
              ds_by_pid=1
              ds_given=$((ds_given + 1))
              shift 2
              ;;
            -*) echo "$ds_usage" >&2; exit 1 ;;
            *)
              ds_id="$1"
              ds_given=$((ds_given + 1))
              shift
              ;;
          esac
        done
        if [ "$ds_given" -ne 1 ]; then echo "$ds_usage" >&2; exit 1; fi
        if [ -n "$ds_by_pid" ]; then
          case "$ds_pid" in
            ''|*[!0-9]*) echo "$ds_usage" >&2; exit 1 ;;
          esac
        elif [ -z "$ds_id" ]; then
          echo "$ds_usage" >&2
          exit 1
        fi
        if [ -z "$TASKFLOW_PROJECT_ID" ]; then
          echo "Error: TASKFLOW_PROJECT_ID is not set" >&2
          exit 1
        fi
        if [ -n "$ds_by_pid" ]; then
          ds_pid=$(printf '%s' "$ds_pid" | sed 's/^0*\([0-9]\)/\1/')
          api_request DELETE "$TASKFLOW_API_URL/api/dev-servers?pid=$ds_pid"
        else
          api_request DELETE "$TASKFLOW_API_URL/api/dev-servers/$ds_id"
        fi
        ;;
      *)
        echo "Usage: taskflow-cli devserver <add|list|remove>" >&2
        exit 1
        ;;
    esac
    ;;
```

The usage check runs before the project-context check on purpose. The "refuses add … before any request" test passes the owner env, while the "without project context" test passes valid arguments, so both orders are covered.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd packages/backend && bun test tests/services/taskflow-cli.test.ts`
Expected: PASS, old and new.

Also check that the script is still POSIX: `sh -n packages/backend/src/services/taskflow-cli.sh` (from the repo root). If it's installed, also run `dash -n …`. Expected: no output.

- [ ] **Step 5: Commit**

```bash
git add packages/backend/src/services/taskflow-cli.sh packages/backend/tests/services/taskflow-cli.test.ts
git commit -m "feat(cli): devserver add, list and remove (sh)"
```

### Task 2: TS binary

**Files:**
- Modify: `packages/backend/src/services/taskflow-cli-bin.ts`:
  - a new `contextHeaders()` helper after `ownerField()` (around line 95);
  - `handleNotify` (around line 881), which uses that helper;
  - a new `handleDevserver` after `handleNotify`;
  - a `case "devserver":` in `main()`'s switch, after `case "notify":`.
- Modify: `packages/backend/tests/services/taskflow-cli-bin-session.test.ts`. Add a dev-server fake API and a new `describe` block, reusing `runBin`.

**Interfaces:** the same commands, rules and requests as Task 1.

- [ ] **Step 1: Write the failing tests**

The existing `startServer` records `{ method, path, body }`, and its tests compare against exactly that shape with `toEqual`, so leave it alone. Add a second fake API below it that records the query string and the context headers:

```ts
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
```

Add this block at the end of the file:

```ts
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
```

`remove --pid 5 --pid 6` is a usage error on both sides. The sh test and this one pin it. So are a bare `--` where a flag could stand and an argument starting with `-` that isn't a known flag: the sh `case` rejects both, while `consumeFlags` treats `--` as end-of-flags and `-x` as positional. `--` as a flag's value (`--label --`) is accepted by both.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd packages/backend && bun test tests/services/taskflow-cli-bin-session.test.ts`
Expected: the new `devserver` tests FAIL (unknown command `devserver`, exit 1, help printed). The existing session-owner tests PASS.

- [ ] **Step 3: Implement**

a) Add after `ownerField()`:

```ts
/** The caller's context, for routes that act on "the caller's owner". */
function contextHeaders(): Record<string, string> {
    const headers: Record<string, string> = {};
    if (projectId) headers["X-Taskflow-Project-Id"] = projectId;
    if (taskId) headers["X-Taskflow-Task-Id"] = taskId;
    if (sessionId) headers["X-Taskflow-Session-Id"] = sessionId;
    return headers;
}
```

b) `handleNotify` builds the same headers by hand. Replace its `headers` object and `if (taskId)` block with the helper; the behaviour is identical, because notify requires both the project and session ids:

```ts
async function handleNotify(args: string[]): Promise<void> {
    const message = args[0] ?? "";
    if (!message) {
        process.stderr.write("Usage: taskflow-cli notify <message>\n");
        process.exit(1);
    }
    requireProjectId();
    requireSessionId();
    process.stdout.write(await api("POST", "/api/notifications", { message }, contextHeaders()));
}
```

c) Add after `handleNotify`:

```ts
const DIGITS = /^\d+$/;

/**
 * True when a bare `--` stands where a flag could. `consumeFlags` reads it as
 * end-of-flags; the sh CLI rejects it. `valueFlags` take the next argument, so
 * `--label --` is a value, not a sentinel.
 */
function hasEndOfFlags(args: string[], valueFlags: string[]): boolean {
    for (let i = 0; i < args.length; i++) {
        if (args[i] === "--") return true;
        if (valueFlags.includes(args[i])) i++;
    }
    return false;
}

async function handleDevserver(args: string[]): Promise<void> {
    const subcmd = args[0] ?? "";
    const subArgs = args.slice(1);

    switch (subcmd) {
        case "add": {
            const usage = 'Usage: taskflow-cli devserver add --pid <pid> --label "<label>"\n';
            const { flags, positional, unknown } = consumeFlags(subArgs, {
                pid: "string",
                label: "string",
            });
            const pid = typeof flags.pid === "string" ? flags.pid : "";
            const label = typeof flags.label === "string" ? flags.label : "";
            if (
                hasEndOfFlags(subArgs, ["--pid", "--label"]) ||
                !DIGITS.test(pid) ||
                !label ||
                positional.length > 0 ||
                unknown.length > 0
            ) {
                process.stderr.write(usage);
                process.exit(1);
            }
            requireProjectId();
            process.stdout.write(
                await api(
                    "POST",
                    "/api/dev-servers",
                    { pid: Number(pid), label },
                    contextHeaders(),
                ),
            );
            break;
        }
        case "list": {
            const { flags, positional, unknown } = consumeFlags(subArgs, { all: "boolean" });
            if (hasEndOfFlags(subArgs, []) || positional.length > 0 || unknown.length > 0) {
                process.stderr.write("Usage: taskflow-cli devserver list [--all]\n");
                process.exit(1);
            }
            if (flags.all === true) {
                // Same headers as the sh script, which always sends the context that's set.
                process.stdout.write(
                    await api("GET", "/api/dev-servers?all=1", undefined, contextHeaders()),
                );
                break;
            }
            requireProjectId();
            process.stdout.write(
                await api("GET", "/api/dev-servers", undefined, contextHeaders()),
            );
            break;
        }
        case "remove": {
            const usage = "Usage: taskflow-cli devserver remove <id> | --pid <pid>\n";
            // consumeFlags keeps only the last of a repeated flag, so count --pid here
            // to reject `--pid 5 --pid 6` like the sh CLI.
            const pidFlags = subArgs.filter((arg) => arg === "--pid").length;
            const { flags, positional, unknown } = consumeFlags(subArgs, { pid: "string" });
            const pid = typeof flags.pid === "string" ? flags.pid : undefined;
            const byPid = pid !== undefined && positional.length === 0 && DIGITS.test(pid);
            // `-x` is positional to consumeFlags; the sh CLI rejects it as an unknown flag.
            const byId =
                pid === undefined &&
                positional.length === 1 &&
                positional[0] !== "" &&
                !positional[0].startsWith("-");
            if (
                hasEndOfFlags(subArgs, ["--pid"]) ||
                unknown.length > 0 ||
                pidFlags > 1 ||
                (!byPid && !byId)
            ) {
                process.stderr.write(usage);
                process.exit(1);
            }
            requireProjectId();
            const path = byPid
                ? `/api/dev-servers?pid=${Number(pid)}`
                : `/api/dev-servers/${encodeURIComponent(positional[0])}`;
            process.stdout.write(await api("DELETE", path, undefined, contextHeaders()));
            break;
        }
        default:
            process.stderr.write("Usage: taskflow-cli devserver <add|list|remove>\n");
            process.exit(1);
    }
}
```

d) In `main()`, add after `case "notify":`:

```ts
        case "devserver":
            await handleDevserver(rest);
            break;
```

`api()` already writes `Error: POST /api/dev-servers returned 400: {"error":"…"}` to stderr and exits 1, which is what the validation test checks.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd packages/backend && bun test tests/services/taskflow-cli-bin-session.test.ts`
Expected: PASS, old and new.

Run `cd packages/backend && bun test tests/services/taskflow-cli.test.ts` as well. Notify's sh side didn't change, but confirm nothing else regressed.

- [ ] **Step 5: Commit**

```bash
git add packages/backend/src/services/taskflow-cli-bin.ts packages/backend/tests/services/taskflow-cli-bin-session.test.ts
git commit -m "feat(cli): devserver add, list and remove (binary)"
```

### Task 3: Command doc and prompt paragraph

**Files:**
- Create: `packages/backend/src/services/taskflow-cli-devserver-commands.md`
- Modify: `packages/backend/src/services/internal-agent-skill.ts`:
  - import the doc and register it in `COMMAND_FILES` (lines 6-39);
  - append the paragraph to `PROMPT_BASE` (lines 46-53);
  - write `PROMPT_BASE` to `taskflow-agent-prompt.md` next to `SKILL.md` in `ensureInternalAgentSkillFile`, and list that file first in OpenCode's `instructions`.
- Modify: `packages/backend/src/services/taskflow-cli-skill.md`. Add a path line before "All other commands".
- Modify: `packages/backend/tests/services/internal-agent-skill.test.ts`

**Interfaces:**
- Produces:
  - the prompt paragraph in every `buildSystemPrompt(...)` output, with or without the skill block;
  - OpenCode delivery. OpenCode's launch spec passes no system prompt: its config carries only `instructions: [skillPath]`, so it never saw `PROMPT_BASE`. Its `instructions` become `[<skill dir>/taskflow-agent-prompt.md, skillPath]`, and `ensureInternalAgentSkillFile` writes that file with `PROMPT_BASE`. Claude, Pi and Codex get the paragraph through their system-prompt flags, and Kimi through its typed initial input;
  - **Known limitation, not changed here:** Kimi started without a prompt gets no system prompt at all (`initialInput` is `undefined`), which is the existing behaviour for every Taskflow instruction. It's recorded in the spec's "Amendments";
  - `taskflow-cli-devserver-commands.md` written by `ensureInternalAgentSkillFile` and inlined by `getResolvedCliHelp()`, which serves `/api/cli-help`.
- `/api/cli-help` (`settings-routes.ts:49`) is built from the skill md and `COMMAND_FILES`, so registering the doc is the whole help-text change. The sh script and the binary don't list command groups themselves: their unknown-command fallback prints `/api/cli-help`.

- [ ] **Step 1: Write the failing tests**

In `internal-agent-skill.test.ts`, extend the import from `../../src/services/internal-agent-skill` with `ensureInternalAgentSkillFile` and `getResolvedCliHelp`.

Add to `describe("internal agent skill")`, after "flow block is only included when isFlowScope is true":

```ts
    it("tells every agent to register the dev servers it starts", () => {
        const paragraph =
            'When you start a dev server or another long-running process the user is meant to open or use (dev or preview servers, Storybook, local API servers), register it as soon as it\'s running: `taskflow-cli devserver add --pid <pid> --label "<what> :<port>"`. If you stop a server you registered, run `taskflow-cli devserver remove --pid <pid>`.';
        for (const prompt of [
            buildSystemPrompt(false),
            buildSystemPrompt(true),
            buildSystemPrompt(false, true),
            buildSystemPrompt(false, false, false),
        ]) {
            expect(prompt).toContain(paragraph);
        }
    });

    it("gives OpenCode the Taskflow prompt file before the skill", () => {
        const skillPath = "/tmp/ignored/SKILL.md";
        for (const prompt of ["Do it", undefined]) {
            const spec = buildAgentLaunchSpec("opencode", prompt, skillPath);
            const config = JSON.parse(spec.env!.OPENCODE_CONFIG_CONTENT) as {
                instructions: string[];
            };
            expect(config.instructions).toEqual([
                join(dirname(skillPath), "taskflow-agent-prompt.md"),
                skillPath,
            ]);
        }
    });

    it("serves the devserver commands in the CLI help", () => {
        const help = getResolvedCliHelp();
        expect(help).toContain('taskflow-cli devserver add --pid <pid> --label "<label>"');
        expect(help).toContain("taskflow-cli devserver remove --pid <pid>");
        expect(help).not.toContain("@taskflow-cli-devserver-commands.md");
    });
```

Add a new `describe` **at the end of the file**. `ensureInternalAgentSkillFile` sets the module's `resolvedSkillDir`, which changes how later `buildSystemPrompt` calls render the skill paths, so it must run after every other test in the file:

```ts
describe("internal agent skill files", () => {
    it("writes the devserver doc and references it by path, not inlined", async () => {
        const baseDir = await mkdtemp(join(tmpdir(), "taskflow-skill-test-"));
        tempDirs.push(baseDir);

        const skillPath = await ensureInternalAgentSkillFile(baseDir);
        const skillDir = dirname(skillPath);
        const docPath = join(skillDir, "taskflow-cli-devserver-commands.md");

        expect(await readFile(docPath, "utf8")).toContain("taskflow-cli devserver list --all");
        const skill = await readFile(skillPath, "utf8");
        expect(skill).toContain(docPath);
        expect(skill).not.toContain("taskflow-cli devserver add");
    });

    it("writes the Taskflow prompt file that OpenCode loads", async () => {
        const baseDir = await mkdtemp(join(tmpdir(), "taskflow-skill-test-"));
        tempDirs.push(baseDir);

        const skillPath = await ensureInternalAgentSkillFile(baseDir);
        const prompt = await readFile(join(dirname(skillPath), "taskflow-agent-prompt.md"), "utf8");

        expect(prompt).toContain("You are running inside Taskflow application");
        expect(prompt).toContain("taskflow-cli devserver add --pid <pid>");
    });
});
```

`mkdtemp`, `readFile`, `join`, `dirname` and `tmpdir` are already imported in this file.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd packages/backend && bun test tests/services/internal-agent-skill.test.ts`
Expected: the five new tests FAIL. The paragraph is missing, OpenCode's `instructions` holds only the skill, the help has no devserver commands, and neither new file exists.

- [ ] **Step 3: Implement**

a) Create `packages/backend/src/services/taskflow-cli-devserver-commands.md`. It lists syntax only, with no hints on finding a PID:

```markdown
## Dev server commands
`taskflow-cli devserver add --pid <pid> --label "<label>"` Register a dev server you started so the user can see and stop it in Taskflow. Registering the same pid again updates its label.
`taskflow-cli devserver list` List the dev servers registered for the current task (or project, in a project-level session).
`taskflow-cli devserver list --all` List every registered dev server.
`taskflow-cli devserver remove <id>` Forget a registered dev server. It does not stop the process.
`taskflow-cli devserver remove --pid <pid>` Forget a registered dev server by pid. It does not stop the process.
```

b) In `internal-agent-skill.ts`, add the import after `sessionCommandsMd`:

```ts
import devserverCommandsMd from "./taskflow-cli-devserver-commands.md" with { type: "text" };
```

Then add to `COMMAND_FILES`, after the session entry:

```ts
    "taskflow-cli-devserver-commands.md": devserverCommandsMd,
```

c) Append the paragraph to `PROMPT_BASE`. It's a template literal, so the backticks are escaped. The constant becomes:

```ts
const PROMPT_BASE = `
You are running inside Taskflow application that orchestrates ai agents and terminal sessions based on tasks and projects. Use taskflow-cli to interact with host app data layer when needed. Any user mention of tasks, projects, flows, actions, schedules, sessions and agents is more likely to refer to taskflow cli than to your internal tools. You may need to read referenced docs to get full list of commands.\n
Project is usually a repo but can be a plain folder.
Task is self explanatory. Tasks can be executed in worktrees.
Action is a prefedined prompt with various agent settings.
Flow is a set of Actions executed one after another.
Session is a cli process running an agent.
Schedule is a recurring cli process running an agent.

When you start a dev server or another long-running process the user is meant to open or use (dev or preview servers, Storybook, local API servers), register it as soon as it's running: \`taskflow-cli devserver add --pid <pid> --label "<what> :<port>"\`. If you stop a server you registered, run \`taskflow-cli devserver remove --pid <pid>\`.`;
```

Leave the existing lines byte-for-byte as they are, including the `\n` and the typo "prefedined". Only the blank line and the paragraph are new.

d) OpenCode delivery. Add a constant next to `SKILL_FILE_NAME`:

```ts
// OpenCode takes no system prompt, only instruction files, so PROMPT_BASE goes in one.
const AGENT_PROMPT_FILE_NAME = "taskflow-agent-prompt.md";
```

In `ensureInternalAgentSkillFile`'s `writeSkillFiles`, after the `SKILL.md` write is pushed:

```ts
        writeOps.push(
            writeFile(join(skillDir, AGENT_PROMPT_FILE_NAME), `${PROMPT_BASE.trim()}\n`, "utf8"),
        );
```

In `buildAgentLaunchSpec`'s OpenCode branch:

```ts
        const config: Record<string, unknown> = {
            instructions: [join(dirname(skillPath), AGENT_PROMPT_FILE_NAME), skillPath],
        };
```

e) In `taskflow-cli-skill.md`, add before `# All other commands`:

```markdown
# All dev server commands
@taskflow-cli-devserver-commands.md

```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd packages/backend && bun test tests/services/internal-agent-skill.test.ts`
Expected: PASS, old and new. In particular, "prompts do not reference TASKFLOW env vars" and "Codex developer_instructions does not duplicate the skill body" still pass.

Then run the section's checks, from the repo root:

```bash
bun run typecheck
bunx eslint packages/backend/src/services/taskflow-cli-bin.ts packages/backend/src/services/internal-agent-skill.ts packages/backend/tests/services/taskflow-cli.test.ts packages/backend/tests/services/taskflow-cli-bin-session.test.ts packages/backend/tests/services/internal-agent-skill.test.ts
bunx prettier --check packages/backend/src/services/taskflow-cli-bin.ts packages/backend/src/services/internal-agent-skill.ts packages/backend/src/services/taskflow-cli-devserver-commands.md packages/backend/src/services/taskflow-cli-skill.md packages/backend/tests/services/taskflow-cli.test.ts packages/backend/tests/services/taskflow-cli-bin-session.test.ts packages/backend/tests/services/internal-agent-skill.test.ts
cd packages/backend && bun test
```

Expected: everything passes. If prettier flags a file, use `bunx prettier --write <that file>`, never `bun run format`. Rerun the known flaky `platform.test.ts` test once before investigating it.

- [ ] **Step 5: Commit**

```bash
git add packages/backend/src/services/taskflow-cli-devserver-commands.md packages/backend/src/services/internal-agent-skill.ts packages/backend/src/services/taskflow-cli-skill.md packages/backend/tests/services/internal-agent-skill.test.ts
git commit -m "feat(backend): devserver command doc and agent prompt paragraph"
```

### Handoff after this section

Record in `handoff.md`:
- `api_request` (sh) now always sends the `X-Taskflow-*` context headers that are set.
- `contextHeaders()` (TS bin) is shared by `notify` and `devserver`.
- OpenCode now loads `taskflow-agent-prompt.md` (PROMPT_BASE), written next to `SKILL.md`, before the skill.
- The fake curl in `taskflow-cli.test.ts` records headers (`readCapturedHeaders`).
- Section 5's manual check should run `sh packages/backend/src/services/taskflow-cli.sh devserver add|list|remove` against the real backend with the session env.
