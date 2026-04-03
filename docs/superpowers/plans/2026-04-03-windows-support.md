# Windows Support Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Taskflow fully functional on Windows by eliminating all Unix-specific assumptions across the backend, Electron shell, CLI tool, and UI.

**Architecture:** Introduce a thin `platform.ts` utility module that centralises platform detection, path delimiters, home directory resolution, and config directory conventions. Each platform-specific callsite is then updated to use these utilities instead of hardcoded Unix values. The POSIX shell CLI script (`taskflow-cli.sh`) is rewritten as a compiled TypeScript binary using Bun's `--compile` flag, eliminating the shell dependency entirely. Electron build config gains a `win` target.

**Tech Stack:** TypeScript, Bun, Electron, electron-builder

---

## File Structure

### New Files
- `packages/backend/src/services/platform.ts` — Platform detection utilities (home dir, config dir, PATH delimiter, null device, shell defaults)
- `packages/backend/src/services/taskflow-cli.ts` — TypeScript rewrite of `taskflow-cli.sh` (compiled to binary via `bun build --compile`)
- `packages/backend/tests/services/platform.test.ts` — Tests for platform utilities
- `packages/backend/tests/services/taskflow-cli-bin.test.ts` — Tests for the TS-based CLI

### Modified Files
- `packages/backend/src/config.ts` — Use platform-aware base directory
- `packages/backend/src/services/shell-detector.ts` — Add Windows shell detection
- `packages/backend/src/services/shell-path.ts` — Use `path.delimiter`, Windows PATH resolution
- `packages/backend/src/services/internal-agent-skill.ts` — Platform-aware CLI script deployment
- `packages/backend/src/services/pty-manager.ts` — Conditional locale env vars
- `packages/backend/src/services/git-service.ts` — `/dev/null` → platform null device
- `packages/backend/src/index.ts` — Windows-safe signal handling
- `packages/backend/package.json` — Platform-aware `build:bin` script
- `packages/ui/src/lib/terminal-shells.ts` — Cross-platform path parsing
- `electron/src/backend-manager.ts` — `.exe` suffix on Windows
- `electron/src/window-manager.ts` — Platform-conditional window styling
- `electron/src/tray-manager.ts` — Windows system tray support
- `electron/build.ts` — Replace `which` with cross-platform check, Windows icon handling
- `electron/package.json` — Add `win` build target

---

### Task 1: Create Platform Utilities Module

**Files:**
- Create: `packages/backend/src/services/platform.ts`
- Test: `packages/backend/tests/services/platform.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// packages/backend/tests/services/platform.test.ts
import { describe, expect, it } from "bun:test";
import {
    getHomeDir,
    getConfigBaseDir,
    getPathDelimiter,
    getNullDevice,
    getDefaultShell,
    isWindows,
} from "../src/services/platform";

describe("platform", () => {
    it("isWindows returns boolean", () => {
        expect(typeof isWindows()).toBe("boolean");
    });

    it("getHomeDir returns a non-empty string", () => {
        expect(getHomeDir().length).toBeGreaterThan(0);
    });

    it("getConfigBaseDir returns a path containing 'taskflow'", () => {
        expect(getConfigBaseDir()).toContain("taskflow");
    });

    it("getPathDelimiter returns : or ;", () => {
        const d = getPathDelimiter();
        expect(d === ":" || d === ";").toBe(true);
    });

    it("getNullDevice returns /dev/null or NUL", () => {
        const n = getNullDevice();
        expect(n === "/dev/null" || n === "NUL").toBe(true);
    });

    it("getDefaultShell returns a non-empty string", () => {
        expect(getDefaultShell().length).toBeGreaterThan(0);
    });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/backend && bun test tests/services/platform.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write the platform utilities module**

```typescript
// packages/backend/src/services/platform.ts
import { homedir } from "os";
import { join } from "path";
import { delimiter } from "path";

function isWindows(): boolean {
    return process.platform === "win32";
}

function getHomeDir(): string {
    return homedir();
}

function getConfigBaseDir(): string {
    if (isWindows()) {
        const appData = process.env.APPDATA;
        if (appData) return join(appData, "taskflow");
        return join(homedir(), "AppData", "Roaming", "taskflow");
    }
    return join(homedir(), ".config", "taskflow");
}

function getPathDelimiter(): string {
    return delimiter;
}

function getNullDevice(): string {
    return isWindows() ? "NUL" : "/dev/null";
}

function getDefaultShell(): string {
    if (isWindows()) {
        return process.env.COMSPEC || "cmd.exe";
    }
    return process.env.SHELL || "/bin/bash";
}

function getDefaultShellEnvVar(): string | undefined {
    return isWindows() ? process.env.COMSPEC : process.env.SHELL;
}

function getEnsurePaths(): string[] {
    const home = getHomeDir();
    if (isWindows()) {
        return [
            join(home, ".bun", "bin"),
            join(home, ".cargo", "bin"),
        ];
    }
    return [
        join(home, ".local", "bin"),
        join(home, ".bun", "bin"),
        join(home, ".cargo", "bin"),
        "/usr/local/bin",
        "/opt/homebrew/bin",
        "/opt/homebrew/sbin",
    ];
}

export {
    isWindows,
    getHomeDir,
    getConfigBaseDir,
    getPathDelimiter,
    getNullDevice,
    getDefaultShell,
    getDefaultShellEnvVar,
    getEnsurePaths,
};
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/backend && bun test tests/services/platform.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/backend/src/services/platform.ts packages/backend/tests/services/platform.test.ts
git commit -m "feat: add cross-platform utilities module for Windows support"
```

---

### Task 2: Make Config Paths Platform-Aware

**Files:**
- Modify: `packages/backend/src/config.ts:7`

- [ ] **Step 1: Write the failing test**

No new test file needed — existing config is tested implicitly. Verify the change works by running:

Run: `cd packages/backend && bun test`
Expected: All existing tests pass (baseline)

- [ ] **Step 2: Update config.ts to use platform utility**

In `packages/backend/src/config.ts`, replace line 7:

```typescript
// OLD:
const BASE_DIR = join(homedir(), ".config", "taskflow");

// NEW:
import { getConfigBaseDir } from "./services/platform";
const BASE_DIR = getConfigBaseDir();
```

Also remove `homedir` from the `os` import on line 5 if it is no longer used directly (check: `homedir()` is not called elsewhere in config.ts — it is NOT used elsewhere, so remove it).

The full import line becomes:
```typescript
import { tmpdir } from "os";
```

- [ ] **Step 3: Run tests to verify nothing broke**

Run: `cd packages/backend && bun test`
Expected: All tests pass

- [ ] **Step 4: Commit**

```bash
git add packages/backend/src/config.ts
git commit -m "refactor: use platform-aware config base directory"
```

---

### Task 3: Make Shell Path Builder Cross-Platform

**Files:**
- Modify: `packages/backend/src/services/shell-path.ts:54,80,89-96,108,129`

- [ ] **Step 1: Update shell-path.ts**

Replace the entire file content with this cross-platform version:

```typescript
import { spawnSync } from "child_process";
import { readFileSync, readdirSync, statSync } from "fs";
import { join, delimiter } from "path";
import { config } from "../config";
import { isWindows, getHomeDir, getDefaultShell, getEnsurePaths } from "./platform";

function resolveNvmNodeBin(home: string): string | null {
    const nvmDir = join(home, ".nvm");
    try {
        const alias = readFileSync(join(nvmDir, "alias", "default"), "utf8").trim();
        const versionsDir = join(nvmDir, "versions", "node");
        const installed = readdirSync(versionsDir);
        const matching = installed
            .filter((v) => {
                const stripped = v.startsWith("v") ? v.slice(1) : v;
                return stripped === alias || stripped.startsWith(`${alias}.`);
            })
            .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
        if (matching.length === 0) return null;
        const binDir = join(versionsDir, matching[0], "bin");
        statSync(binDir);
        return binDir;
    } catch {
        return null;
    }
}

function resolveVoltaBin(home: string): string | null {
    const binDir = join(home, ".volta", "bin");
    try {
        statSync(binDir);
        return binDir;
    } catch {
        return null;
    }
}

function resolveFnmNodeBin(home: string): string | null {
    const binDir = isWindows()
        ? join(home, ".fnm", "aliases", "default")
        : join(home, ".fnm", "aliases", "default", "bin");
    try {
        statSync(binDir);
        return binDir;
    } catch {
        return null;
    }
}

function resolveLoginShellPath(): string {
    if (isWindows()) {
        // On Windows, process.env.PATH is already the full user PATH
        return process.env.PATH ?? "";
    }

    const shell = getDefaultShell();
    try {
        const result = spawnSync(shell, ["-l", "-c", "echo $PATH"], {
            encoding: "utf8",
            timeout: 5000,
            env: {
                ...process.env,
                TERM: "dumb",
            },
        });
        const output = result.stdout?.trim();
        if (output && !result.error && result.status === 0) {
            return output;
        }
    } catch {
        // Fall through to process.env.PATH
    }
    return process.env.PATH ?? "";
}

let cachedPath: string | null = null;

export function buildShellPath(): string {
    if (cachedPath) return cachedPath;

    const home = getHomeDir();
    const loginPath = resolveLoginShellPath();
    const prependPaths = [config.binDir];
    const ensurePaths = getEnsurePaths();

    const nodeResolvers = [resolveNvmNodeBin, resolveVoltaBin, resolveFnmNodeBin];
    for (const resolve of nodeResolvers) {
        const binDir = resolve(home);
        if (binDir) {
            ensurePaths.push(binDir);
            break;
        }
    }

    const loginParts = loginPath.split(delimiter);
    const seen = new Set(loginParts);

    for (const p of ensurePaths) {
        if (!seen.has(p)) {
            loginParts.push(p);
            seen.add(p);
        }
    }

    const finalParts: string[] = [];
    for (const p of prependPaths) {
        if (!seen.has(p)) {
            finalParts.push(p);
            seen.add(p);
        }
    }
    finalParts.push(...loginParts);

    cachedPath = finalParts.join(delimiter);
    return cachedPath;
}
```

- [ ] **Step 2: Run tests**

Run: `cd packages/backend && bun test`
Expected: All tests pass

- [ ] **Step 3: Commit**

```bash
git add packages/backend/src/services/shell-path.ts
git commit -m "refactor: make shell-path builder cross-platform using path.delimiter"
```

---

### Task 4: Make Shell Detector Cross-Platform

**Files:**
- Modify: `packages/backend/src/services/shell-detector.ts`

- [ ] **Step 1: Update shell-detector.ts**

Replace the full file with:

```typescript
import { readFile, access } from "fs/promises";
import { constants } from "fs";
import { basename } from "path";
import type { ShellInfo } from "@taskflow/shared";
import { isWindows, getDefaultShellEnvVar } from "./platform";

const UNIX_SHELLS = new Set(["bash", "zsh"]);
const WINDOWS_SHELLS = new Set(["powershell", "pwsh", "cmd"]);

function knownShells(): Set<string> {
    return isWindows() ? WINDOWS_SHELLS : UNIX_SHELLS;
}

async function isExecutable(path: string): Promise<boolean> {
    try {
        if (isWindows()) {
            // On Windows, check file exists (no execute permission concept)
            await access(path, constants.F_OK);
        } else {
            await access(path, constants.X_OK);
        }
        return true;
    } catch {
        return false;
    }
}

function isSupportedShell(path: string): boolean {
    const name = basename(path).replace(/\.exe$/i, "");
    return knownShells().has(name);
}

export function resolveSystemShellPath(
    shells: ShellInfo[],
    envShell = getDefaultShellEnvVar() ?? null,
): string | null {
    const normalizedEnvShell = envShell?.trim();
    if (normalizedEnvShell && isSupportedShell(normalizedEnvShell)) {
        const exact = shells.find((shell) => shell.path === normalizedEnvShell);
        if (exact) return exact.path;

        const envShellName = basename(normalizedEnvShell).replace(/\.exe$/i, "");
        const byName = shells.find((shell) => shell.name === envShellName);
        if (byName) return byName.path;
    }

    return shells[0]?.path ?? null;
}

function prioritizeSystemShell(
    shells: ShellInfo[],
    envShell = getDefaultShellEnvVar() ?? null,
): ShellInfo[] {
    const systemShellPath = resolveSystemShellPath(shells, envShell);
    if (!systemShellPath) return shells;

    const index = shells.findIndex((shell) => shell.path === systemShellPath);
    if (index <= 0) return shells;

    return [shells[index], ...shells.slice(0, index), ...shells.slice(index + 1)];
}

async function detectWindowsShells(): Promise<ShellInfo[]> {
    const shells: ShellInfo[] = [];

    // PowerShell 7+ (pwsh)
    const pwshPath = Bun.which("pwsh");
    if (pwshPath) {
        shells.push({ name: "pwsh", path: pwshPath });
    }

    // Windows PowerShell 5.x
    const powershellPath = Bun.which("powershell");
    if (powershellPath) {
        shells.push({ name: "powershell", path: powershellPath });
    }

    // cmd.exe
    const comspec = process.env.COMSPEC || "C:\\Windows\\System32\\cmd.exe";
    if (await isExecutable(comspec)) {
        shells.push({ name: "cmd", path: comspec });
    }

    // Git Bash (if installed)
    const bashPath = Bun.which("bash");
    if (bashPath) {
        shells.push({ name: "bash", path: bashPath });
    }

    return prioritizeSystemShell(shells);
}

async function detectUnixShells(): Promise<ShellInfo[]> {
    let content: string;
    try {
        content = await readFile("/etc/shells", "utf-8");
    } catch {
        return [];
    }

    const seen = new Set<string>();
    const shells: ShellInfo[] = [];

    for (const line of content.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;

        const name = basename(trimmed);
        if (!UNIX_SHELLS.has(name)) continue;
        if (seen.has(name)) continue;

        if (await isExecutable(trimmed)) {
            seen.add(name);
            shells.push({ name, path: trimmed });
        }
    }

    return prioritizeSystemShell(shells);
}

export async function detectShells(): Promise<ShellInfo[]> {
    return isWindows() ? detectWindowsShells() : detectUnixShells();
}
```

- [ ] **Step 2: Run tests**

Run: `cd packages/backend && bun test`
Expected: All tests pass (existing shell-detector tests are Unix-only and should still pass on macOS/Linux)

- [ ] **Step 3: Commit**

```bash
git add packages/backend/src/services/shell-detector.ts
git commit -m "feat: add Windows shell detection (PowerShell, cmd, Git Bash)"
```

---

### Task 5: Rewrite taskflow-cli as Compiled TypeScript Binary

This is the largest task. The current `taskflow-cli.sh` is a ~800 line POSIX shell script that wraps HTTP calls to the backend API using `curl`, `awk`, `sed`, `uuidgen`, etc. None of these work on Windows without Unix tool chains.

The approach: rewrite in TypeScript using `fetch()` for HTTP and Bun APIs for everything else, then compile via `bun build --compile`.

**Files:**
- Create: `packages/backend/src/services/taskflow-cli.ts`
- Modify: `packages/backend/src/services/internal-agent-skill.ts:4,121-126`
- Modify: `packages/backend/package.json:10`

- [ ] **Step 1: Read the full taskflow-cli.sh to understand all commands**

Read the full shell script and catalog every command/subcommand and its HTTP endpoint. The CLI has these top-level commands (each maps to curl calls against `TASKFLOW_API_URL`):

- `task` (get, list, list-archived, create, update, archive, unarchive, delete, worktree)
- `log` (info, error, warning, commit, file)
- `project` (get, list, create, update, delete, link, unlink)
- `flow` (list, get, create, update, delete, run)
- `action` (list, get, create, update, delete, run)
- `flow-context` (get, step, log, set-status)
- `agent` (list, start, stop)
- `schedule` (list, get, create, update, delete, run)
- `session` (list, get, close)
- `browser` (open, search, read)
- `notify`, `open`

- [ ] **Step 2: Create the TypeScript CLI**

Create `packages/backend/src/services/taskflow-cli.ts`. This is a standalone script that will be compiled with `bun build --compile`. It uses only `fetch()` and standard Node/Bun APIs.

The file is large, so it follows this structure:

```typescript
// packages/backend/src/services/taskflow-cli.ts
// Standalone CLI — compiled via: bun build src/services/taskflow-cli.ts --compile --outfile dist/taskflow-cli

const API_URL = process.env.TASKFLOW_API_URL;
if (!API_URL) {
    process.stderr.write("Error: TASKFLOW_API_URL is not set\n");
    process.exit(1);
}

let taskId = process.env.TASKFLOW_TASK_ID ?? "";
let projectId = process.env.TASKFLOW_PROJECT_ID ?? "";
let sessionId = process.env.TASKFLOW_SESSION_ID ?? "";

// --- Helpers ---

function jsonString(value: string): string {
    return JSON.stringify(value);
}

async function api(
    method: string,
    path: string,
    body?: Record<string, unknown>,
): Promise<string> {
    const url = `${API_URL}${path}`;
    const options: RequestInit = {
        method,
        headers: body ? { "Content-Type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
    };
    const res = await fetch(url, options);
    if (!res.ok) {
        const text = await res.text();
        process.stderr.write(`Error: ${method} ${path} -> ${res.status} ${text}\n`);
        process.exit(1);
    }
    return res.text();
}

function requireTaskId(): string {
    if (!taskId) {
        process.stderr.write("Error: TASKFLOW_TASK_ID is not set\n");
        process.exit(1);
    }
    return taskId;
}

function requireProjectId(): string {
    if (!projectId) {
        process.stderr.write("Error: TASKFLOW_PROJECT_ID is not set\n");
        process.exit(1);
    }
    return projectId;
}

// --- Parse global flags ---
const rawArgs = process.argv.slice(2);
const args: string[] = [];

for (let i = 0; i < rawArgs.length; i++) {
    if (rawArgs[i] === "--task" && rawArgs[i + 1]) {
        taskId = rawArgs[++i];
    } else if (rawArgs[i] === "--project-id" && rawArgs[i + 1]) {
        projectId = rawArgs[++i];
    } else {
        args.push(rawArgs[i]);
    }
}

const cmd = args[0] ?? "";
const rest = args.slice(1);

// --- Argument parser helper ---
function parseFlags(
    argv: string[],
    spec: Record<string, "string" | "boolean">,
): { flags: Record<string, string | boolean>; positional: string[] } {
    const flags: Record<string, string | boolean> = {};
    const positional: string[] = [];
    for (let i = 0; i < argv.length; i++) {
        const key = argv[i].replace(/^--/, "");
        if (argv[i].startsWith("--") && spec[key] === "string") {
            flags[key] = argv[++i] ?? "";
        } else if (argv[i].startsWith("--") && spec[key] === "boolean") {
            flags[key] = true;
        } else {
            positional.push(argv[i]);
        }
    }
    return { flags, positional };
}

// --- Command dispatch ---
// Each command mirrors the exact behavior of taskflow-cli.sh.
// Implementation follows the same pattern: parse args, call api(), print result.
//
// [Full implementation of all commands goes here, following the same
//  structure as the shell script but using fetch() instead of curl,
//  JSON.stringify() instead of awk/sed, and crypto.randomUUID() instead of uuidgen]

async function main() {
    switch (cmd) {
        case "task": await handleTask(rest); break;
        case "log": await handleLog(rest); break;
        case "project": await handleProject(rest); break;
        case "flow": await handleFlow(rest); break;
        case "action": await handleAction(rest); break;
        case "flow-context": await handleFlowContext(rest); break;
        case "agent": await handleAgent(rest); break;
        case "schedule": await handleSchedule(rest); break;
        case "session": await handleSession(rest); break;
        case "browser": await handleBrowser(rest); break;
        case "notify": await handleNotify(rest); break;
        case "open": await handleOpen(rest); break;
        default:
            process.stderr.write(`Unknown command: ${cmd}\n`);
            process.exit(1);
    }
}

main().catch((err: unknown) => {
    process.stderr.write(`${err}\n`);
    process.exit(1);
});
```

Each `handle*` function is a direct port of the corresponding shell case block. For example:

```typescript
async function handleTask(argv: string[]) {
    const subcmd = argv[0] ?? "";
    const subArgs = argv.slice(1);

    if (!subcmd) {
        const id = requireTaskId();
        process.stdout.write(await api("GET", `/api/tasks/${id}`));
        return;
    }

    switch (subcmd) {
        case "list": {
            const pid = requireProjectId();
            process.stdout.write(await api("GET", `/api/projects/${pid}/tasks`));
            break;
        }
        case "list-archived": {
            process.stdout.write(await api("GET", "/api/tasks/archived"));
            break;
        }
        case "create": {
            const pid = requireProjectId();
            const description = subArgs[0];
            if (!description) {
                process.stderr.write("Usage: taskflow-cli task create <description> [--title <title>] [--worktree] [--init <command>]\n");
                process.exit(1);
            }
            const { flags } = parseFlags(subArgs.slice(1), {
                title: "string",
                worktree: "boolean",
                init: "string",
            });
            const body: Record<string, unknown> = { description };
            if (flags.title) body.title = flags.title;
            if (flags.worktree) body.worktree = true;
            if (flags.init) body.initCommand = flags.init;
            process.stdout.write(await api("POST", `/api/projects/${pid}/tasks`, body));
            break;
        }
        // ... remaining subcmds: update, archive, unarchive, delete, worktree
    }
}

async function handleLog(argv: string[]) {
    const id = requireTaskId();
    const logType = argv[0] ?? "";
    const logMessage = argv[1] ?? "";
    if (!logType || !logMessage) {
        process.stderr.write("Usage: taskflow-cli log <type> <message> [--hash <hash>]\n");
        process.exit(1);
    }
    const { flags } = parseFlags(argv.slice(2), { hash: "string" });
    const body: Record<string, unknown> = {
        sessionId: sessionId || "cli",
        type: logType,
        message: logMessage,
    };
    if (flags.hash) body.hash = flags.hash;
    process.stdout.write(await api("POST", `/api/tasks/${id}/log`, body));
}
```

The full implementation ports ALL commands from the shell script. Key replacements:
- `curl` → `fetch()`
- `awk`/`sed` JSON escaping → `JSON.stringify()`
- `uuidgen` → `crypto.randomUUID()`
- `date -u` → `new Date().toISOString()`
- `printf` → `process.stdout.write()`

- [ ] **Step 3: Add build:cli script to package.json**

In `packages/backend/package.json`, add a new script:

```json
"build:cli": "bun build src/services/taskflow-cli.ts --compile --outfile dist/taskflow-cli"
```

- [ ] **Step 4: Update internal-agent-skill.ts to deploy the compiled binary**

In `packages/backend/src/services/internal-agent-skill.ts`, replace the shell script deployment with binary deployment:

```typescript
// OLD (lines 4, 121-126):
import cliScript from "./taskflow-cli.sh" with { type: "text" };
// ...
export async function ensureCliScript(binDir: string): Promise<void> {
    const scriptPath = join(binDir, "taskflow-cli");
    await mkdir(binDir, { recursive: true });
    await writeFile(scriptPath, cliScript, "utf8");
    await chmod(scriptPath, 0o755);
}

// NEW:
import { isWindows } from "./platform";
import cliScript from "./taskflow-cli.sh" with { type: "text" };

export async function ensureCliScript(binDir: string): Promise<void> {
    await mkdir(binDir, { recursive: true });

    if (isWindows()) {
        // On Windows, the compiled binary (taskflow-cli.exe) is placed in binDir
        // during the build step. We only need to ensure the directory exists.
        // If running in dev mode, write a batch file wrapper.
        const batPath = join(binDir, "taskflow-cli.bat");
        const batContent = `@echo off\nbun run "%~dp0..\\..\\..\\packages\\backend\\src\\services\\taskflow-cli.ts" %*\n`;
        await writeFile(batPath, batContent, "utf8");
    } else {
        const scriptPath = join(binDir, "taskflow-cli");
        await writeFile(scriptPath, cliScript, "utf8");
        await chmod(scriptPath, 0o755);
    }
}
```

- [ ] **Step 5: Run tests**

Run: `cd packages/backend && bun test`
Expected: All tests pass

- [ ] **Step 6: Commit**

```bash
git add packages/backend/src/services/taskflow-cli.ts packages/backend/src/services/internal-agent-skill.ts packages/backend/package.json
git commit -m "feat: rewrite taskflow-cli as TypeScript for cross-platform support"
```

---

### Task 6: Make PTY Manager Cross-Platform

**Files:**
- Modify: `packages/backend/src/services/pty-manager.ts:139-148`

- [ ] **Step 1: Update environment variables in spawn()**

In `packages/backend/src/services/pty-manager.ts`, replace lines 139-148:

```typescript
// OLD:
env: {
    ...cleanEnv,
    PATH: buildShellPath(),
    TERM: "xterm-256color",
    TERM_PROGRAM: "xterm-256color",
    COLORTERM: "truecolor",
    LANG: cleanEnv.LANG || "en_US.UTF-8",
    LC_ALL: cleanEnv.LC_ALL || "en_US.UTF-8",
    ...options.env,
},

// NEW:
import { isWindows } from "./platform";
// ... (add import at top of file)

// In spawn():
env: {
    ...cleanEnv,
    PATH: buildShellPath(),
    TERM: "xterm-256color",
    TERM_PROGRAM: "xterm-256color",
    COLORTERM: "truecolor",
    ...(isWindows() ? {} : {
        LANG: cleanEnv.LANG || "en_US.UTF-8",
        LC_ALL: cleanEnv.LC_ALL || "en_US.UTF-8",
    }),
    ...options.env,
},
```

- [ ] **Step 2: Run tests**

Run: `cd packages/backend && bun test tests/services/pty-manager.test.ts`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add packages/backend/src/services/pty-manager.ts
git commit -m "refactor: skip Unix locale env vars on Windows in PTY manager"
```

---

### Task 7: Fix Git Service Null Device

**Files:**
- Modify: `packages/backend/src/services/git-service.ts:171`

- [ ] **Step 1: Update /dev/null reference**

In `packages/backend/src/services/git-service.ts`, add import and update line 171:

```typescript
// Add to imports:
import { getNullDevice } from "./platform";

// OLD (line 171):
["diff", "--no-index", "--", "/dev/null", join(repoPath, file.path)],

// NEW:
["diff", "--no-index", "--", getNullDevice(), join(repoPath, file.path)],
```

- [ ] **Step 2: Run tests**

Run: `cd packages/backend && bun test`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add packages/backend/src/services/git-service.ts
git commit -m "fix: use platform-aware null device in git diff"
```

---

### Task 8: Fix Backend Signal Handling

**Files:**
- Modify: `packages/backend/src/index.ts:462-463`

- [ ] **Step 1: Make signal handling Windows-safe**

In `packages/backend/src/index.ts`, replace lines 462-463:

```typescript
// OLD:
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

// NEW:
process.on("SIGINT", shutdown);
if (process.platform !== "win32") {
    process.on("SIGTERM", shutdown);
}
```

Note: On Windows, the Electron parent process kills the backend via `ChildProcess.kill()` which sends a `SIGTERM`-like termination. Node.js on Windows handles this via `process.on('exit')` implicitly. Adding explicit `SIGINT` handling still works on Windows for Ctrl+C.

- [ ] **Step 2: Run tests**

Run: `cd packages/backend && bun test`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add packages/backend/src/index.ts
git commit -m "fix: skip SIGTERM handler on Windows"
```

---

### Task 9: Fix UI Terminal Shell Path Parsing

**Files:**
- Modify: `packages/ui/src/lib/terminal-shells.ts:12`

- [ ] **Step 1: Update path splitting**

In `packages/ui/src/lib/terminal-shells.ts`, replace line 12:

```typescript
// OLD:
return path.split("/").pop() ?? "shell";

// NEW:
return path.split(/[/\\]/).pop() ?? "shell";
```

This regex splits on both forward and back slashes, handling both Unix and Windows paths.

- [ ] **Step 2: Run tests**

Run: `cd packages/ui && bun run typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add packages/ui/src/lib/terminal-shells.ts
git commit -m "fix: handle Windows backslashes in shell path parsing"
```

---

### Task 10: Fix Electron Backend Manager for Windows

**Files:**
- Modify: `electron/src/backend-manager.ts:26`

- [ ] **Step 1: Add .exe suffix on Windows**

In `electron/src/backend-manager.ts`, update the `getBackendPath` function:

```typescript
// OLD (line 26):
const binary = join(process.resourcesPath, "backend", "taskflow-backend");

// NEW:
const binaryName = process.platform === "win32" ? "taskflow-backend.exe" : "taskflow-backend";
const binary = join(process.resourcesPath, "backend", binaryName);
```

- [ ] **Step 2: Commit**

```bash
git add electron/src/backend-manager.ts
git commit -m "fix: append .exe suffix for Windows backend binary"
```

---

### Task 11: Fix Electron Window Manager for Windows

**Files:**
- Modify: `electron/src/window-manager.ts:68-71`

- [ ] **Step 1: Make window styling platform-conditional**

In `electron/src/window-manager.ts`, replace lines 62-78:

```typescript
// OLD:
const windowOptions: Electron.BrowserWindowConstructorOptions = {
    width: validBounds?.width ?? 1400,
    height: validBounds?.height ?? 900,
    ...(validBounds ? { x: validBounds.x, y: validBounds.y } : {}),
    minWidth: 800,
    minHeight: 600,
    titleBarStyle: "hiddenInset",
    backgroundColor: "#00000000",
    vibrancy: "under-window",
    visualEffectState: "active",
    webPreferences: {
        preload: join(appPath, "dist", "preload.js"),
        contextIsolation: true,
        nodeIntegration: false,
        webviewTag: true,
    },
};

// NEW:
const macOptions: Partial<Electron.BrowserWindowConstructorOptions> =
    process.platform === "darwin"
        ? {
              titleBarStyle: "hiddenInset",
              backgroundColor: "#00000000",
              vibrancy: "under-window",
              visualEffectState: "active",
          }
        : {
              backgroundColor: "#1e1e1e",
          };

const windowOptions: Electron.BrowserWindowConstructorOptions = {
    width: validBounds?.width ?? 1400,
    height: validBounds?.height ?? 900,
    ...(validBounds ? { x: validBounds.x, y: validBounds.y } : {}),
    minWidth: 800,
    minHeight: 600,
    ...macOptions,
    webPreferences: {
        preload: join(appPath, "dist", "preload.js"),
        contextIsolation: true,
        nodeIntegration: false,
        webviewTag: true,
    },
};
```

- [ ] **Step 2: Commit**

```bash
git add electron/src/window-manager.ts
git commit -m "fix: use platform-conditional window styling for Windows"
```

---

### Task 12: Add Windows System Tray Support

**Files:**
- Modify: `electron/src/tray-manager.ts:112`

- [ ] **Step 1: Remove the darwin-only guard**

In `electron/src/tray-manager.ts`, update `setupMenuBarTray()`:

```typescript
// OLD (line 112):
if (process.platform !== "darwin" || menuBarTray) return;

// NEW:
if (menuBarTray) return;
```

The function already uses `nativeImage` and `Tray` which work on Windows. The icon creation needs a Windows-safe fallback since template images are macOS-only:

```typescript
// Update createMenuBarIcon() to handle Windows:
function createMenuBarIcon(): Electron.NativeImage {
    if (process.platform === "darwin") {
        const image = nativeImage.createFromPath(getMenuBarIcon2xPath());
        image.setTemplateImage(true);
        return image;
    }
    // Windows/Linux: use the regular icon (not template)
    return nativeImage.createFromPath(getMenuBarIconPath());
}
```

Also update `createIconWithDot` to skip template image logic on non-macOS:

```typescript
function createIconWithDot(color: [number, number, number]): Electron.NativeImage {
    if (process.platform !== "darwin") {
        // On Windows, just return the base icon (dot overlay requires macOS template images)
        return nativeImage.createFromPath(getMenuBarIconPath());
    }
    // ... existing macOS implementation ...
}
```

- [ ] **Step 2: Commit**

```bash
git add electron/src/tray-manager.ts
git commit -m "feat: enable system tray on Windows with fallback icon handling"
```

---

### Task 13: Fix Electron Build System

**Files:**
- Modify: `electron/build.ts:17-27`
- Modify: `electron/package.json:43-55`

- [ ] **Step 1: Replace `which` with cross-platform check**

In `electron/build.ts`, replace lines 17-27:

```typescript
// OLD:
function commandExists(command: string): boolean {
    try {
        execFileSync("which", [command], {
            stdio: "ignore",
            timeout: 3000,
        });
        return true;
    } catch {
        return false;
    }
}

// NEW:
function commandExists(command: string): boolean {
    const whichCmd = process.platform === "win32" ? "where" : "which";
    try {
        execFileSync(whichCmd, [command], {
            stdio: "ignore",
            timeout: 3000,
        });
        return true;
    } catch {
        return false;
    }
}
```

- [ ] **Step 2: Add Windows build target to electron/package.json**

In `electron/package.json`, add Windows config after the `mac` section:

```json
"win": {
    "target": ["nsis", "portable"],
    "icon": "build/icon.ico"
},
```

Also update `extraResources` to handle Windows binary name. In `electron/package.json`, update the backend resource:

```json
"extraResources": [
    {
        "from": "../packages/backend/dist/taskflow-backend${os === 'win32' ? '.exe' : ''}",
        "to": "backend/taskflow-backend${os === 'win32' ? '.exe' : ''}"
    },
    {
        "from": "../packages/ui/dist",
        "to": "ui"
    }
]
```

Note: electron-builder supports `${os}` variable in file patterns. If that doesn't work, use platform-specific `extraResources` under the `mac`/`win` keys:

```json
"mac": {
    "extraResources": [
        { "from": "../packages/backend/dist/taskflow-backend", "to": "backend/taskflow-backend" }
    ],
    ...
},
"win": {
    "extraResources": [
        { "from": "../packages/backend/dist/taskflow-backend.exe", "to": "backend/taskflow-backend.exe" }
    ],
    "target": ["nsis", "portable"]
}
```

Move the `ui` resource to the shared `extraResources` (it's platform-agnostic):

```json
"extraResources": [
    { "from": "../packages/ui/dist", "to": "ui" }
],
```

- [ ] **Step 3: Make afterSign conditional (macOS only)**

The `afterSign` notarize script should only run on macOS. electron-builder handles this automatically — `afterSign` only runs for the platform being built. No change needed if building on Windows (it won't run macOS notarization). But to be safe, update `electron/scripts/notarize.js` to early-return on non-macOS (if it doesn't already).

- [ ] **Step 4: Commit**

```bash
git add electron/build.ts electron/package.json
git commit -m "feat: add Windows build target and cross-platform build fixes"
```

---

### Task 14: Update Backend Build Script for Windows Binary

**Files:**
- Modify: `packages/backend/package.json:10`

- [ ] **Step 1: Update build:bin to handle Windows .exe**

In `packages/backend/package.json`, the `build:bin` script should produce the right binary name. Since `bun build --compile` on Windows auto-appends `.exe`, this mostly works. But for clarity and CI, add a separate script:

```json
"build:bin": "bun build src/index.ts --compile --outfile dist/taskflow-backend",
"build:cli": "bun build src/services/taskflow-cli.ts --compile --outfile dist/taskflow-cli"
```

Bun automatically appends `.exe` on Windows when using `--compile`, so no conditional logic needed in the script itself.

- [ ] **Step 2: Commit**

```bash
git add packages/backend/package.json
git commit -m "feat: add build:cli script for cross-platform CLI binary"
```

---

### Task 15: Update Tests for Cross-Platform Compatibility

**Files:**
- Modify: `packages/backend/tests/services/shell-detector.test.ts`
- Modify: `packages/backend/tests/services/taskflow-cli.test.ts:82`
- Modify: `packages/backend/tests/services/pty-manager.test.ts`
- Modify: `packages/backend/tests/handlers/session.test.ts`

- [ ] **Step 1: Fix PATH delimiter in taskflow-cli test**

In `packages/backend/tests/services/taskflow-cli.test.ts`, replace line 82:

```typescript
// OLD:
PATH: `${fakeBinDir}:${process.env.PATH ?? ""}`,

// NEW:
import { delimiter } from "path";
// ...
PATH: `${fakeBinDir}${delimiter}${process.env.PATH ?? ""}`,
```

- [ ] **Step 2: Fix shell paths in pty-manager and session tests**

In `packages/backend/tests/services/pty-manager.test.ts` and `packages/backend/tests/handlers/session.test.ts`, wrap Unix-specific tests in platform guards:

```typescript
import { describe, it, expect } from "bun:test";

const isWindows = process.platform === "win32";
const testShell = isWindows ? (process.env.COMSPEC ?? "cmd.exe") : "/bin/sh";

// Replace all "/bin/sh" and "/bin/cat" references with platform-appropriate values
```

For pty-manager tests that use `/bin/cat`, `/bin/sh`:
```typescript
const testShell = isWindows ? "cmd.exe" : "/bin/sh";
const echoCommand = isWindows ? "cmd.exe" : "/bin/cat";
const echoArgs = isWindows ? ["/c", "echo", "hello"] : [];
```

- [ ] **Step 3: Run all tests**

Run: `cd packages/backend && bun test`
Expected: All tests pass

- [ ] **Step 4: Commit**

```bash
git add packages/backend/tests/
git commit -m "test: make test suite cross-platform compatible"
```

---

## Summary of Changes

| Task | Component | Effort | Impact |
|------|-----------|--------|--------|
| 1 | Platform utilities module | Small | Foundation for everything |
| 2 | Config paths | Small | Config dir works on Windows |
| 3 | Shell path builder | Medium | PATH construction works |
| 4 | Shell detector | Medium | Windows shells detected |
| 5 | CLI rewrite in TypeScript | Large | Eliminates #1 blocker |
| 6 | PTY env vars | Small | Terminal sessions work |
| 7 | Git null device | Small | Git diffs work |
| 8 | Signal handling | Small | Clean shutdown on Windows |
| 9 | UI path parsing | Small | Shell names display correctly |
| 10 | Backend manager .exe | Small | Backend binary found |
| 11 | Window manager styling | Small | Window renders properly |
| 12 | Tray manager | Medium | System tray works |
| 13 | Build system | Medium | Windows builds produced |
| 14 | Build scripts | Small | CI can build CLI |
| 15 | Tests | Medium | Tests pass on Windows |

## Known Limitations / Future Work

1. **Bun PTY on Windows** — Bun's `terminal` option in `Bun.spawn()` may not be fully stable on Windows. This is a Bun runtime dependency. If it doesn't work, the fallback would be integrating `node-pty` as a native dependency, which is a separate effort.

2. **Windows CI** — This plan doesn't include setting up Windows CI/CD. A follow-up task should add a Windows runner to the GitHub Actions matrix.

3. **Code signing** — Windows code signing (Authenticode) is not configured. The `win` build target will produce unsigned binaries. A follow-up task should add certificate-based signing.

4. **Windows icon** — The plan assumes an `.ico` file exists at `electron/build/icon.ico`. This needs to be created from the existing icon assets.

5. **Keeping shell script** — The POSIX shell script (`taskflow-cli.sh`) is kept for backward compatibility on macOS/Linux dev mode. In production builds, the compiled TypeScript binary should be used on all platforms.
