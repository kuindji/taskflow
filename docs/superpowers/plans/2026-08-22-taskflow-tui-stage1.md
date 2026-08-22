# Taskflow TUI — Stage 1 (Foundation and Live Sessions) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A terminal client that spawns its own Taskflow backend, lists projects and tasks in a sidebar, and creates, attaches to and renders live agent sessions beside it.

**Architecture:** A new Bun workspace package `packages/tui` talking to the existing backend over its WebSocket protocol. Each open session gets a client-side `@xterm/headless` terminal fed by `TERMINAL_OUTPUT` events; its cell buffer is blitted into a global double-buffered screen that diffs frames before writing to stdout. Keyboard input is decoded from the outer terminal, routed by focus, and re-encoded per child according to that child's own terminal modes.

**Tech Stack:** Bun, TypeScript (strict), `@xterm/headless` 5.5, `@taskflow/shared` for protocol types, `bun:test`.

**Spec:** `docs/superpowers/specs/2026-08-22-taskflow-tui-client-design.md`

## Global Constraints

- Use `bun`, never `npm` or `yarn`, for installing dependencies and running anything.
- No `as any`. ESLint runs `typescript-eslint` `strictTypeChecked` across the repo; `any` will fail the build.
- Do not add `eslint-disable` comments. Fix the underlying type instead.
- Do not export a symbol unless another module imports it. Unused exports fail review.
- Reuse types from `@taskflow/shared` before defining new ones. Protocol message names come from the `MSG` constant, never string literals.
- Do not add co-authored-by trailers to commits.
- Every file in this plan is under `packages/tui/` unless stated otherwise.
- Tests are `bun:test`, colocated as `<name>.test.ts` beside the file under test.
- Run the full check before every commit: `bun run lint && bun run typecheck && bun test`.

## Stage scope

In this stage: package scaffold, backend lifecycle, WS client, the render core, the input pipeline, session attach, the state store, a working sidebar-plus-session UI, and remote operation over an SSH tunnel.

Deferred to Stage 2: flows, actions, schedules, YAML record editing.
Deferred to Stage 3: git changes and commit, settings pickers, task detail, notifications.

## File Structure

| File | Responsibility |
|---|---|
| `package.json`, `tsconfig.json` | Package manifest and TS config |
| `src/net/client.ts` | `WsClient` — connect, correlated request/response, event subscription |
| `src/backend/manager.ts` | Spawn the backend binary, discover its port, kill it on exit |
| `src/render/cells.ts` | `Cell`, `Color`, attribute bitfield, `ScreenBuffer` |
| `src/render/sgr.ts` | Cell attributes to SGR escape sequences |
| `src/render/screen.ts` | Double-buffered screen: diff, coalesce, flush, cursor |
| `src/term/tty.ts` | Raw mode, alt screen, protocol push/pop, restoration on every exit path |
| `src/input/keys.ts` | `KeyEvent`, `KeyMods`, `KeyName` |
| `src/input/decode-legacy.ts` | Legacy byte stream to `KeyEvent[]` |
| `src/input/decode-kitty.ts` | Kitty `CSI u` stream to `KeyEvent[]` |
| `src/input/negotiate.ts` | Query the outer terminal, pick a decoder |
| `src/input/encode.ts` | `KeyEvent` to bytes for one child, honoring its modes |
| `src/term/session-terminal.ts` | Headless xterm per session: attach, resync, modes, blit |
| `src/state/store.ts` | Mirror of projects, tasks and sessions |
| `src/ui/routing.ts` | Pure focus-and-key to action mapping |
| `src/ui/sidebar.ts` | Draw the project and task tree |
| `src/ui/session-pane.ts` | Draw the tab strip and the session cell grid |
| `src/ui/app.ts` | Compose the above, own layout and focus |
| `src/index.ts` | Entry point, CLI argument parsing, and main loop |
| `packages/backend/src/ws/server.ts` | Modified: bind to loopback, broadcast client count |

## Shared interfaces

These types are defined in the tasks noted and used across later tasks. They are reproduced here so any task can be implemented without reading its neighbors.

```ts
// src/render/cells.ts — Task 3
type Color =
    | { kind: "default" }
    | { kind: "palette"; index: number }
    | { kind: "rgb"; r: number; g: number; b: number };

interface Cell {
    ch: string;      // "" marks the continuation cell of a wide glyph
    width: 0 | 1 | 2;
    fg: Color;
    bg: Color;
    attrs: number;   // bitfield, see ATTR_* below
}

const ATTR_BOLD = 1;
const ATTR_DIM = 2;
const ATTR_ITALIC = 4;
const ATTR_UNDERLINE = 8;
const ATTR_INVERSE = 16;
const ATTR_STRIKE = 32;

class ScreenBuffer {
    constructor(cols: number, rows: number);
    readonly cols: number;
    readonly rows: number;
    get(x: number, y: number): Cell;
    set(x: number, y: number, cell: Cell): void;
    clear(): void;
}
```

```ts
// src/render/screen.ts — Task 4
interface Sink {
    write(data: string): void;
}

class Screen {
    constructor(sink: Sink, cols: number, rows: number);
    back: ScreenBuffer; // replaced on flush and resize, so not readonly
    setCursor(pos: { x: number; y: number } | null): void; // null hides the cursor
    flush(): void;
    resize(cols: number, rows: number): void;
}
```

```ts
// src/input/keys.ts — Task 6
interface KeyMods {
    ctrl: boolean;
    alt: boolean;
    shift: boolean;
    super: boolean;
}

type KeyName =
    | "char" | "enter" | "escape" | "tab" | "backspace" | "space"
    | "up" | "down" | "left" | "right"
    | "home" | "end" | "pageup" | "pagedown" | "delete" | "insert";

interface KeyEvent {
    name: KeyName;
    char?: string; // set only when name is "char"
    mods: KeyMods;
    kind: "press" | "repeat" | "release";
}
```

```ts
// src/input/encode.ts — Task 8
interface ChildModes {
    applicationCursorKeys: boolean;
    bracketedPaste: boolean;
    kittyFlags: number | null; // null when the child never pushed the protocol
}
```

```ts
// src/net/client.ts — Task 1
interface NetLike {
    request<T>(type: string, payload?: unknown): Promise<T>;
    on(type: string, handler: (payload: unknown) => void): () => void;
    onStatusChange(listener: (status: { connected: boolean }) => void): () => void;
}
```

---

### Task 1: Package scaffold and WebSocket client

**Files:**
- Create: `packages/tui/package.json`
- Create: `packages/tui/tsconfig.json`
- Modify: `eslint.config.js`
- Create: `packages/tui/src/net/client.ts`
- Test: `packages/tui/src/net/client.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `interface NetLike { request<T>(type, payload?): Promise<T>; on(type, handler): () => void; onStatusChange(listener: (status: { connected: boolean }) => void): () => void }` and `class WsClient implements NetLike` with `constructor(port: number)`, `connect(): Promise<void>`, `close(): void`.

`onStatusChange` belongs on the interface, not just the class, because `App` holds its dependency as `NetLike` and subscribes to connection state in Task 18. Every test fake therefore implements it as `onStatusChange: () => () => undefined`.

The existing UI client (`packages/ui/src/hooks/useWebSocket.ts`) is a module-level singleton. Deliberately do not copy that shape — a class is needed so tests can run several clients at once.

- [ ] **Step 1: Create the package manifest and TS config**

`packages/tui/package.json`:

```json
{
    "name": "@taskflow/tui",
    "version": "0.1.0",
    "private": true,
    "type": "module",
    "scripts": {
        "dev": "TASKFLOW_DEV=1 bun run src/index.ts",
        "build:bin": "bun build src/index.ts --compile --outfile dist/taskflow-tui",
        "test": "bun test",
        "typecheck": "tsc --noEmit"
    },
    "dependencies": {
        "@taskflow/shared": "workspace:*",
        "@xterm/headless": "^5.5.0"
    },
    "devDependencies": {
        "typescript": "^5.7.0"
    }
}
```

`packages/tui/tsconfig.json`:

```json
{
    "extends": "../../tsconfig.base.json",
    "compilerOptions": {
        "outDir": "dist",
        "rootDir": "."
    },
    "include": ["src"]
}
```

Then run `bun install` from the repo root to link the workspace.

- [ ] **Step 2: Give the new package its ESLint globals**

`packages/tui/src/**` matches no globals block today, so `bun run lint` would
report `Bun`, `process`, `WebSocket` and `MessageEvent` as undefined. Extend the
existing backend/shared block in `eslint.config.js` — the one whose `files`
array ends with `"packages/shared/tests/**/*.ts"` — by adding the TUI path and
the two WebSocket globals:

```js
        files: [
            // ...existing entries unchanged...
            "packages/shared/tests/**/*.ts",
            "packages/tui/src/**/*.ts",
        ],
        languageOptions: {
            globals: {
                ...globals.node,
                Bun: "readonly",
                WebSocket: "readonly",
                MessageEvent: "readonly",
            },
        },
```

Verify with `bun run lint` once the first source file exists; it must pass with
no `no-undef` errors.

- [ ] **Step 3: Write the failing test**

`packages/tui/src/net/client.test.ts`:

```ts
import { describe, test, expect, afterEach } from "bun:test";
import type { Server } from "bun";
import { WsClient } from "./client";

let server: Server<unknown> | null = null;

afterEach(() => {
    server?.stop(true);
    server = null;
});

function startEchoServer(): number {
    server = Bun.serve({
        port: 0,
        fetch(req, s) {
            if (s.upgrade(req, { data: {} })) return undefined;
            return new Response("no");
        },
        websocket: {
            message(ws, raw) {
                const req = JSON.parse(String(raw)) as {
                    correlationId: string;
                    type: string;
                    payload: unknown;
                };
                if (req.type === "boom") {
                    ws.send(
                        JSON.stringify({
                            correlationId: req.correlationId,
                            type: req.type,
                            payload: null,
                            error: "exploded",
                        }),
                    );
                    return;
                }
                ws.send(
                    JSON.stringify({
                        correlationId: req.correlationId,
                        type: req.type,
                        payload: { echo: req.payload },
                    }),
                );
                ws.send(JSON.stringify({ type: "note", payload: { n: 1 } }));
            },
        },
    });
    return server.port ?? 0;
}

describe("WsClient", () => {
    test("resolves a request with its correlated response", async () => {
        const client = new WsClient(startEchoServer());
        await client.connect();
        const result = await client.request<{ echo: unknown }>("hello", { a: 1 });
        expect(result).toEqual({ echo: { a: 1 } });
        client.close();
    });

    test("rejects when the response carries an error", async () => {
        const client = new WsClient(startEchoServer());
        await client.connect();
        await expect(client.request("boom")).rejects.toThrow("exploded");
        client.close();
    });

    test("delivers events to subscribers and stops after unsubscribe", async () => {
        const client = new WsClient(startEchoServer());
        await client.connect();
        const seen: unknown[] = [];
        const off = client.on("note", (payload) => seen.push(payload));
        await client.request("hello", {});
        await Bun.sleep(20);
        expect(seen).toEqual([{ n: 1 }]);
        off();
        await client.request("hello", {});
        await Bun.sleep(20);
        expect(seen).toHaveLength(1);
        client.close();
    });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `bun test packages/tui/src/net/client.test.ts`
Expected: FAIL — cannot resolve module `./client`.

- [ ] **Step 5: Write the implementation**

`packages/tui/src/net/client.ts`:

```ts
import { randomUUID } from "crypto";
import type { WsRequest, WsResponse, WsEvent } from "@taskflow/shared";

interface NetLike {
    request<T>(type: string, payload?: unknown): Promise<T>;
    on(type: string, handler: (payload: unknown) => void): () => void;
    onStatusChange(listener: (status: { connected: boolean }) => void): () => void;
}

interface Pending {
    resolve: (value: unknown) => void;
    reject: (reason: Error) => void;
    timer: ReturnType<typeof setTimeout>;
}

const REQUEST_TIMEOUT_MS = 30_000;

class WsClient implements NetLike {
    private ws: WebSocket | null = null;
    private readonly pending = new Map<string, Pending>();
    private readonly listeners = new Map<string, Set<(payload: unknown) => void>>();
    private readonly statusListeners = new Set<(status: { connected: boolean }) => void>();

    constructor(private readonly port: number) {}

    connect(): Promise<void> {
        return new Promise((resolve, reject) => {
            const ws = new WebSocket(`ws://127.0.0.1:${String(this.port)}`);
            this.ws = ws;
            ws.onopen = () => {
                this.notifyStatus(true);
                resolve();
            };
            ws.onerror = () => reject(new Error("WebSocket connection error"));
            ws.onclose = () => {
                if (this.ws !== ws) return; // superseded by a newer socket
                // Drop the reference: request() must not try to send on it.
                this.ws = null;
                this.notifyStatus(false);
                this.failPending(new Error("Connection lost"));
            };
            ws.onmessage = (event: MessageEvent) => {
                this.handleMessage(String(event.data));
            };
        });
    }

    onStatusChange(listener: (status: { connected: boolean }) => void): () => void {
        this.statusListeners.add(listener);
        return () => {
            this.statusListeners.delete(listener);
        };
    }

    private notifyStatus(connected: boolean): void {
        for (const listener of this.statusListeners) listener({ connected });
    }

    private failPending(reason: Error): void {
        for (const pending of this.pending.values()) {
            clearTimeout(pending.timer);
            pending.reject(reason);
        }
        this.pending.clear();
    }


    private handleMessage(raw: string): void {
        const parsed: unknown = JSON.parse(raw);
        if (typeof parsed !== "object" || parsed === null) return;

        if ("correlationId" in parsed) {
            const response = parsed as WsResponse;
            const pending = this.pending.get(response.correlationId);
            if (!pending) return;
            clearTimeout(pending.timer);
            this.pending.delete(response.correlationId);
            if (response.error !== undefined) pending.reject(new Error(response.error));
            else pending.resolve(response.payload);
            return;
        }

        const event = parsed as WsEvent;
        const handlers = this.listeners.get(event.type);
        if (!handlers) return;
        for (const handler of handlers) handler(event.payload);
    }

    request<T>(type: string, payload: unknown = {}): Promise<T> {
        const ws = this.ws;
        if (!ws || ws.readyState !== WebSocket.OPEN) {
            return Promise.reject(new Error("Not connected"));
        }
        const correlationId = randomUUID();
        const message: WsRequest = { correlationId, type, payload };
        return new Promise<T>((resolve, reject) => {
            const timer = setTimeout(() => {
                this.pending.delete(correlationId);
                reject(new Error(`Request timed out: ${type}`));
            }, REQUEST_TIMEOUT_MS);
            this.pending.set(correlationId, {
                resolve: resolve as (value: unknown) => void,
                reject,
                timer,
            });
            ws.send(JSON.stringify(message));
        });
    }

    on(type: string, handler: (payload: unknown) => void): () => void {
        let handlers = this.listeners.get(type);
        if (!handlers) {
            handlers = new Set();
            this.listeners.set(type, handlers);
        }
        handlers.add(handler);
        return () => {
            handlers.delete(handler);
        };
    }

    close(): void {
        this.failPending(new Error("Client closed"));
        const ws = this.ws;
        this.ws = null;
        ws?.close();
    }
}

export { WsClient };
export type { NetLike };
```

- [ ] **Step 6: Run tests and lint to verify they pass**

Run: `bun test packages/tui/src/net/client.test.ts && bun run lint`
Expected: PASS, 3 tests, and lint clean.

- [ ] **Step 7: Commit**

```bash
git add packages/tui bun.lock eslint.config.js
git commit -m "feat(tui): add package scaffold and WebSocket client"
```

---

### Task 2: Backend lifecycle

**Files:**
- Create: `packages/tui/src/backend/manager.ts`
- Test: `packages/tui/src/backend/manager.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `async function startBackend(opts: { binary: string; args: string[]; devBranch: string | null; timeoutMs?: number }): Promise<{ port: number; stop(): void }>`.

This mirrors `electron/src/backend-manager.ts:107-140` — set `TASKFLOW_PORT_FILE`, spawn, poll for the file — without the auto-updater or dev-server URL handling. `TASKFLOW_DEV_BRANCH` is what gives the dev instance its own `instanceId` (`packages/backend/src/config.ts:52-66`).

- [ ] **Step 1: Write the failing test**

`packages/tui/src/backend/manager.test.ts`:

```ts
import { describe, test, expect } from "bun:test";
import { mkdtemp, writeFile, chmod } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { startBackend } from "./manager";

async function writeFakeBackend(body: string): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), "tui-backend-test-"));
    const path = join(dir, "fake-backend.sh");
    await writeFile(path, `#!/bin/sh\n${body}\n`);
    await chmod(path, 0o755);
    return path;
}

describe("startBackend", () => {
    test("resolves with the port the backend writes to its port file", async () => {
        const binary = await writeFakeBackend('echo 4321 > "$TASKFLOW_PORT_FILE"; sleep 30');
        const handle = await startBackend({ binary, args: [], devBranch: null });
        expect(handle.port).toBe(4321);
        handle.stop();
    });

    test("passes TASKFLOW_DEV_BRANCH through to the child", async () => {
        // The fake backend encodes the branch it received into the port digits,
        // so a backend that never received it cannot make this assertion pass.
        const binary = await writeFakeBackend(
            'if [ "$TASKFLOW_DEV_BRANCH" = "my-branch" ]; then echo 4322 > "$TASKFLOW_PORT_FILE"; else echo 9999 > "$TASKFLOW_PORT_FILE"; fi; sleep 30',
        );
        const handle = await startBackend({ binary, args: [], devBranch: "my-branch" });
        expect(handle.port).toBe(4322);
        handle.stop();
    });

    test("does not set TASKFLOW_DEV_BRANCH when devBranch is null", async () => {
        const binary = await writeFakeBackend(
            'if [ -z "$TASKFLOW_DEV_BRANCH" ]; then echo 4323 > "$TASKFLOW_PORT_FILE"; else echo 9999 > "$TASKFLOW_PORT_FILE"; fi; sleep 30',
        );
        const handle = await startBackend({ binary, args: [], devBranch: null });
        expect(handle.port).toBe(4323);
        handle.stop();
    });

    test("rejects when the backend exits before writing a port", async () => {
        const binary = await writeFakeBackend("exit 3");
        await expect(
            startBackend({ binary, args: [], devBranch: null, timeoutMs: 2000 }),
        ).rejects.toThrow(/exited/);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/tui/src/backend/manager.test.ts`
Expected: FAIL — cannot resolve module `./manager`.

- [ ] **Step 3: Write the implementation**

`packages/tui/src/backend/manager.ts`:

```ts
import { spawn, type ChildProcess } from "child_process";
import { readFile, rm } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";

interface StartBackendOptions {
    binary: string;
    args: string[];
    devBranch: string | null;
    timeoutMs?: number;
}

interface BackendHandle {
    port: number;
    stop(): void;
}

const DEFAULT_TIMEOUT_MS = 10_000;
const POLL_INTERVAL_MS = 50;

async function readPort(portFile: string): Promise<number | null> {
    try {
        const raw = await readFile(portFile, "utf-8");
        const port = Number.parseInt(raw.trim(), 10);
        return Number.isInteger(port) && port > 0 ? port : null;
    } catch {
        return null;
    }
}

async function startBackend(opts: StartBackendOptions): Promise<BackendHandle> {
    const portFile = join(tmpdir(), `taskflow-tui-port-${process.pid}-${Date.now()}`);
    const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

    const child: ChildProcess = spawn(opts.binary, opts.args, {
        stdio: ["ignore", "ignore", "pipe"],
        env: {
            ...process.env,
            TASKFLOW_PORT_FILE: portFile,
            ...(opts.devBranch === null ? {} : { TASKFLOW_DEV_BRANCH: opts.devBranch }),
        },
    });

    // Held in an object: TypeScript narrows a plain `let` to `never` here,
    // because it cannot see the assignment that happens inside the callback.
    const outcome: { exitCode: number | null; spawnError: Error | null } = {
        exitCode: null,
        spawnError: null,
    };
    child.once("exit", (code) => {
        outcome.exitCode = code ?? 0;
    });
    // Without this listener Node throws on ENOENT instead of rejecting.
    child.once("error", (err: Error) => {
        outcome.spawnError = err;
    });

    const stop = (): void => {
        child.kill();
        void rm(portFile, { force: true });
    };

    const deadline = Date.now() + timeoutMs;
    for (;;) {
        const port = await readPort(portFile);
        if (port !== null) return { port, stop };
        if (outcome.spawnError !== null) {
            await rm(portFile, { force: true });
            throw new Error(`Backend failed to start: ${outcome.spawnError.message}`);
        }
        if (outcome.exitCode !== null) {
            throw new Error(`Backend exited before startup (code ${String(outcome.exitCode)})`);
        }
        if (Date.now() > deadline) {
            stop();
            throw new Error(`Backend startup timeout after ${String(timeoutMs)}ms`);
        }
        await Bun.sleep(POLL_INTERVAL_MS);
    }
}

export { startBackend };
export type { BackendHandle };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test packages/tui/src/backend/manager.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/tui/src/backend
git commit -m "feat(tui): spawn and supervise the backend process"
```

---

### Task 3: Cell model and SGR encoding

**Files:**
- Create: `packages/tui/src/render/cells.ts`
- Create: `packages/tui/src/render/sgr.ts`
- Test: `packages/tui/src/render/sgr.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `Color`, `Cell`, `ScreenBuffer`, the `ATTR_*` constants, `blankCell(): Cell`, `cellsEqual(a: Cell, b: Cell): boolean` from `cells.ts`; and `sgrDiff(from: Cell | null, to: Cell): string` from `sgr.ts`, which returns the escape sequence needed to move the terminal from one attribute state to another (`""` when nothing changes).

Palette colors must emit indexed SGR, never RGB. Translating a palette index to RGB would break live theme switching, which is the entire theming strategy (spec, Theming).

- [ ] **Step 1: Write the failing test**

`packages/tui/src/render/sgr.test.ts`:

```ts
import { describe, test, expect } from "bun:test";
import { blankCell, cellsEqual, ATTR_BOLD, ATTR_UNDERLINE, type Cell } from "./cells";
import { sgrDiff } from "./sgr";

function cell(patch: Partial<Cell>): Cell {
    return { ...blankCell(), ...patch };
}

describe("sgrDiff", () => {
    test("emits nothing when the attribute state is unchanged", () => {
        const a = cell({ fg: { kind: "palette", index: 4 } });
        expect(sgrDiff(a, cell({ fg: { kind: "palette", index: 4 } }))).toBe("");
    });

    test("emits an indexed foreground for a palette color, never rgb", () => {
        const out = sgrDiff(null, cell({ fg: { kind: "palette", index: 4 } }));
        expect(out).toBe("\x1b[0;38;5;4m");
        expect(out).not.toContain("38;2");
    });

    test("emits truecolor only for an rgb color", () => {
        const out = sgrDiff(null, cell({ fg: { kind: "rgb", r: 1, g: 2, b: 3 } }));
        expect(out).toBe("\x1b[0;38;2;1;2;3m");
    });

    test("resets to default when returning to a default color", () => {
        const from = cell({ fg: { kind: "palette", index: 4 } });
        expect(sgrDiff(from, blankCell())).toBe("\x1b[0m");
    });

    test("encodes attributes alongside color", () => {
        const out = sgrDiff(null, cell({ attrs: ATTR_BOLD | ATTR_UNDERLINE }));
        expect(out).toBe("\x1b[0;1;4m");
    });
});

describe("cellsEqual", () => {
    test("distinguishes palette index from rgb with the same number", () => {
        const a = cell({ fg: { kind: "palette", index: 1 } });
        const b = cell({ fg: { kind: "rgb", r: 1, g: 1, b: 1 } });
        expect(cellsEqual(a, b)).toBe(false);
    });

    test("treats identical cells as equal", () => {
        expect(cellsEqual(cell({ ch: "x" }), cell({ ch: "x" }))).toBe(true);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/tui/src/render/sgr.test.ts`
Expected: FAIL — cannot resolve `./cells`.

- [ ] **Step 3: Write `cells.ts`**

```ts
type Color =
    | { kind: "default" }
    | { kind: "palette"; index: number }
    | { kind: "rgb"; r: number; g: number; b: number };

interface Cell {
    ch: string;
    width: 0 | 1 | 2;
    fg: Color;
    bg: Color;
    attrs: number;
}

const ATTR_BOLD = 1;
const ATTR_DIM = 2;
const ATTR_ITALIC = 4;
const ATTR_UNDERLINE = 8;
const ATTR_INVERSE = 16;
const ATTR_STRIKE = 32;

const DEFAULT_COLOR: Color = { kind: "default" };

function blankCell(): Cell {
    return { ch: " ", width: 1, fg: DEFAULT_COLOR, bg: DEFAULT_COLOR, attrs: 0 };
}

function colorsEqual(a: Color, b: Color): boolean {
    if (a.kind !== b.kind) return false;
    if (a.kind === "palette" && b.kind === "palette") return a.index === b.index;
    if (a.kind === "rgb" && b.kind === "rgb") return a.r === b.r && a.g === b.g && a.b === b.b;
    return true;
}

function cellsEqual(a: Cell, b: Cell): boolean {
    return (
        a.ch === b.ch &&
        a.width === b.width &&
        a.attrs === b.attrs &&
        colorsEqual(a.fg, b.fg) &&
        colorsEqual(a.bg, b.bg)
    );
}

class ScreenBuffer {
    private cells: Cell[];

    constructor(
        public readonly cols: number,
        public readonly rows: number,
    ) {
        this.cells = Array.from({ length: cols * rows }, () => blankCell());
    }

    get(x: number, y: number): Cell {
        const cell = this.cells[y * this.cols + x];
        if (!cell) throw new RangeError(`Cell out of range: ${String(x)},${String(y)}`);
        return cell;
    }

    set(x: number, y: number, cell: Cell): void {
        if (x < 0 || x >= this.cols || y < 0 || y >= this.rows) return;
        this.cells[y * this.cols + x] = cell;
    }

    clear(): void {
        for (let i = 0; i < this.cells.length; i++) this.cells[i] = blankCell();
    }
}

export { ScreenBuffer, blankCell, cellsEqual, DEFAULT_COLOR };
export { ATTR_BOLD, ATTR_DIM, ATTR_ITALIC, ATTR_UNDERLINE, ATTR_INVERSE, ATTR_STRIKE };
export type { Cell, Color };
```

Note: `ScreenBuffer.resize` is intentionally not implemented here. `Screen` in Task 4 replaces its buffers on resize instead, so a resize method on the buffer would be an unused export.

- [ ] **Step 4: Write `sgr.ts`**

```ts
import {
    cellsEqual,
    ATTR_BOLD,
    ATTR_DIM,
    ATTR_ITALIC,
    ATTR_UNDERLINE,
    ATTR_INVERSE,
    ATTR_STRIKE,
    type Cell,
    type Color,
} from "./cells";

function colorParams(color: Color, base: 38 | 48): string[] {
    switch (color.kind) {
        case "default":
            return [];
        case "palette":
            return [String(base), "5", String(color.index)];
        case "rgb":
            return [String(base), "2", String(color.r), String(color.g), String(color.b)];
    }
}

const ATTR_CODES: Array<[number, string]> = [
    [ATTR_BOLD, "1"],
    [ATTR_DIM, "2"],
    [ATTR_ITALIC, "3"],
    [ATTR_UNDERLINE, "4"],
    [ATTR_INVERSE, "7"],
    [ATTR_STRIKE, "9"],
];

/**
 * Escape sequence that moves the terminal from `from`'s attribute state to
 * `to`'s. Always emits a full reset before setting, which keeps the encoder
 * stateless at the cost of a few bytes per changed run.
 */
function sgrDiff(from: Cell | null, to: Cell): string {
    if (from !== null && cellsEqual({ ...from, ch: to.ch }, to)) return "";

    const params = ["0"];
    for (const [bit, code] of ATTR_CODES) {
        if ((to.attrs & bit) !== 0) params.push(code);
    }
    params.push(...colorParams(to.fg, 38));
    params.push(...colorParams(to.bg, 48));
    return `\x1b[${params.join(";")}m`;
}

export { sgrDiff };
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `bun test packages/tui/src/render/sgr.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 6: Commit**

```bash
git add packages/tui/src/render
git commit -m "feat(tui): add cell model and SGR encoding"
```

---

### Task 4: Screen diffing and flush

**Files:**
- Create: `packages/tui/src/render/screen.ts`
- Test: `packages/tui/src/render/screen.test.ts`

**Interfaces:**
- Consumes: `ScreenBuffer`, `Cell`, `blankCell`, `cellsEqual` (Task 3); `sgrDiff` (Task 3).
- Produces: `interface Sink { write(data: string): void }` and `class Screen` with `constructor(sink: Sink, cols: number, rows: number)`, `readonly back: ScreenBuffer`, `setCursor(pos: { x: number; y: number } | null): void`, `flush(): void`, `resize(cols: number, rows: number): void`.

An unchanged frame must emit nothing at all. That property is what makes a 60fps loop affordable, so it is the first test.

- [ ] **Step 1: Write the failing test**

`packages/tui/src/render/screen.test.ts`:

```ts
import { describe, test, expect } from "bun:test";
import { Screen, type Sink } from "./screen";
import { blankCell, ATTR_BOLD, type Cell } from "./cells";

function collectingSink(): Sink & { output: string } {
    return {
        output: "",
        write(data: string) {
            this.output += data;
        },
    };
}

function textCell(ch: string, patch: Partial<Cell> = {}): Cell {
    return { ...blankCell(), ch, ...patch };
}

function writeText(screen: Screen, x: number, y: number, text: string): void {
    for (let i = 0; i < text.length; i++) {
        screen.back.set(x + i, y, textCell(text[i] ?? " "));
    }
}

describe("Screen", () => {
    test("repaints the whole screen on the first frame", () => {
        const sink = collectingSink();
        const screen = new Screen(sink, 4, 2);
        screen.setCursor(null);
        screen.flush();
        expect(sink.output).toContain("\x1b[1;1H");
        expect(sink.output).toContain("\x1b[2;1H");
    });

    test("emits nothing when nothing changed between frames", () => {
        const sink = collectingSink();
        const screen = new Screen(sink, 10, 3);
        writeText(screen, 0, 0, "hi");
        screen.flush();
        sink.output = "";
        screen.flush();
        expect(sink.output).toBe("");
    });

    test("positions the cursor once per changed run and writes the text", () => {
        const sink = collectingSink();
        const screen = new Screen(sink, 10, 3);
        screen.setCursor(null);
        screen.flush(); // first frame repaints everything and seeds the front buffer
        sink.output = "";
        writeText(screen, 2, 1, "abc");
        screen.flush();
        expect(sink.output).toContain("\x1b[2;3H");
        expect(sink.output).toContain("abc");
    });

    test("coalesces adjacent cells that share attributes into one SGR", () => {
        const sink = collectingSink();
        const screen = new Screen(sink, 10, 1);
        for (let i = 0; i < 3; i++) {
            screen.back.set(i, 0, textCell("x", { attrs: ATTR_BOLD }));
        }
        screen.setCursor(null);
        screen.flush();
        const sgrCount = sink.output.split("\x1b[0;1m").length - 1;
        expect(sgrCount).toBe(1);
        expect(sink.output).toContain("xxx");
    });

    test("redraws only the cells that changed", () => {
        const sink = collectingSink();
        const screen = new Screen(sink, 10, 2);
        writeText(screen, 0, 0, "aaaa");
        writeText(screen, 0, 1, "bbbb");
        screen.flush();
        sink.output = "";
        screen.back.set(2, 1, textCell("Z"));
        screen.flush();
        expect(sink.output).toContain("Z");
        expect(sink.output).not.toContain("aaaa");
        expect(sink.output).not.toContain("bbbb");
    });

    test("hides the cursor when set to null and shows it at a position", () => {
        const sink = collectingSink();
        const screen = new Screen(sink, 10, 3);
        screen.setCursor(null);
        screen.flush();
        expect(sink.output).toContain("\x1b[?25l");

        sink.output = "";
        screen.setCursor({ x: 4, y: 2 });
        screen.flush();
        expect(sink.output).toContain("\x1b[3;5H");
        expect(sink.output).toContain("\x1b[?25h");
    });

    test("does not share cell objects between frames", () => {
        const sink = collectingSink();
        const screen = new Screen(sink, 4, 1);
        screen.setCursor(null);
        screen.flush();
        sink.output = "";
        screen.back.get(0, 0).ch = "X"; // mutated in place, not via set()
        screen.flush();
        expect(sink.output).toContain("X");
    });

    test("re-emits the cursor after a resize even if it did not move", () => {
        // A full repaint leaves the real cursor wherever the last painted run
        // ended, so an unchanged logical position still has to be re-sent.
        const sink = collectingSink();
        const screen = new Screen(sink, 10, 3);
        screen.setCursor({ x: 2, y: 1 });
        screen.flush();
        screen.resize(12, 4);
        sink.output = "";
        screen.setCursor({ x: 2, y: 1 });
        screen.flush();
        expect(sink.output).toContain("\x1b[2;3H");
    });

    test("repaints everything after a resize", () => {
        const sink = collectingSink();
        const screen = new Screen(sink, 10, 2);
        writeText(screen, 0, 0, "keep");
        screen.flush();
        sink.output = "";
        screen.resize(12, 3);
        writeText(screen, 0, 0, "keep");
        screen.flush();
        expect(sink.output).toContain("keep");
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/tui/src/render/screen.test.ts`
Expected: FAIL — cannot resolve `./screen`.

- [ ] **Step 3: Write the implementation**

`packages/tui/src/render/screen.ts`:

```ts
import { ScreenBuffer, cellsEqual, type Cell } from "./cells";
import { sgrDiff } from "./sgr";

interface Sink {
    write(data: string): void;
}

interface CursorPos {
    x: number;
    y: number;
}

class Screen {
    private front: ScreenBuffer;
    private cursor: CursorPos | null = null;
    private lastCursor: CursorPos | null = null;
    private cursorInitialised = false;
    private forceRepaint = true;

    public back: ScreenBuffer;

    constructor(
        private readonly sink: Sink,
        cols: number,
        rows: number,
    ) {
        this.front = new ScreenBuffer(cols, rows);
        this.back = new ScreenBuffer(cols, rows);
    }

    setCursor(pos: CursorPos | null): void {
        this.cursor = pos;
    }

    resize(cols: number, rows: number): void {
        this.front = new ScreenBuffer(cols, rows);
        this.back = new ScreenBuffer(cols, rows);
        this.forceRepaint = true;
        // A full repaint leaves the real cursor wherever the last run ended, so
        // it must be re-emitted even if its logical position did not change.
        this.cursorInitialised = false;
        this.lastCursor = null;
    }

    flush(): void {
        let out = "";
        let pen: Cell | null = null;

        for (let y = 0; y < this.back.rows; y++) {
            let x = 0;
            while (x < this.back.cols) {
                const next = this.back.get(x, y);
                if (!this.forceRepaint && cellsEqual(this.front.get(x, y), next)) {
                    x++;
                    continue;
                }

                out += `\x1b[${String(y + 1)};${String(x + 1)}H`;
                // Emit the contiguous run of changed cells starting here.
                while (x < this.back.cols) {
                    const cell = this.back.get(x, y);
                    if (!this.forceRepaint && cellsEqual(this.front.get(x, y), cell)) break;
                    const sgr = sgrDiff(pen, cell);
                    if (sgr !== "") out += sgr;
                    pen = cell;
                    if (cell.width !== 0) out += cell.ch;
                    this.front.set(x, y, cell);
                    x++;
                }
            }
        }

        out += this.cursorSequence();

        if (out !== "") this.sink.write(out);
        this.forceRepaint = false;
        this.back = this.cloneFront();
    }

    private cursorSequence(): string {
        const cursor = this.cursor;
        const changed =
            !this.cursorInitialised ||
            cursor?.x !== this.lastCursor?.x ||
            cursor?.y !== this.lastCursor?.y;
        this.cursorInitialised = true;
        this.lastCursor = cursor;
        if (!changed) return "";
        if (cursor === null) return "\x1b[?25l";
        return `\x1b[${String(cursor.y + 1)};${String(cursor.x + 1)}H\x1b[?25h`;
    }

    private cloneFront(): ScreenBuffer {
        const next = new ScreenBuffer(this.front.cols, this.front.rows);
        for (let y = 0; y < this.front.rows; y++) {
            // Copy each cell: sharing references would make an in-place edit
            // to the back buffer invisible to the next frame's diff.
            for (let x = 0; x < this.front.cols; x++) next.set(x, y, { ...this.front.get(x, y) });
        }
        return next;
    }
}

export { Screen };
export type { Sink };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test packages/tui/src/render/screen.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/tui/src/render
git commit -m "feat(tui): add double-buffered screen with frame diffing"
```

---

### Task 5: TTY control and restoration

**Files:**
- Create: `packages/tui/src/term/tty.ts`
- Test: `packages/tui/src/term/tty.test.ts`

**Interfaces:**
- Consumes: `Sink` (Task 4).
- Produces: `interface TtyOptions { kitty: boolean }`, `function enterSequence(opts: TtyOptions): string`, `function leaveSequence(opts: TtyOptions): string`, and `class Tty` with `constructor(sink: Sink, opts: TtyOptions)`, `enter(): void`, `leave(): void`, `installExitHandlers(): void`.

Leaving the user's terminal in raw mode with a hidden cursor is the worst available failure, so `leave()` must be idempotent and must run on every exit path (spec, Terminal restoration).

- [ ] **Step 1: Write the failing test**

`packages/tui/src/term/tty.test.ts`:

```ts
import { describe, test, expect } from "bun:test";
import { Tty, enterSequence, leaveSequence } from "./tty";
import type { Sink } from "../render/screen";

function collectingSink(): Sink & { output: string } {
    return {
        output: "",
        write(data: string) {
            this.output += data;
        },
    };
}

describe("enterSequence", () => {
    test("enters the alternate screen and hides the cursor", () => {
        const out = enterSequence({ kitty: false });
        expect(out).toContain("\x1b[?1049h");
        expect(out).toContain("\x1b[?25l");
    });

    test("pushes kitty keyboard flags only when the protocol is available", () => {
        expect(enterSequence({ kitty: true })).toContain("\x1b[>1u");
        expect(enterSequence({ kitty: false })).not.toContain("\x1b[>1u");
    });
});

describe("leaveSequence", () => {
    test("reverses everything enterSequence set", () => {
        const out = leaveSequence({ kitty: true });
        expect(out).toContain("\x1b[<u");
        expect(out).toContain("\x1b[?1049l");
        expect(out).toContain("\x1b[?25h");
        expect(out).toContain("\x1b[?1000l");
    });

    test("does not pop kitty flags that were never pushed", () => {
        expect(leaveSequence({ kitty: false })).not.toContain("\x1b[<u");
    });
});

describe("Tty", () => {
    test("leave is idempotent", () => {
        const sink = collectingSink();
        const tty = new Tty(sink, { kitty: true });
        tty.enter();
        sink.output = "";
        tty.leave();
        const first = sink.output;
        sink.output = "";
        tty.leave();
        expect(first).not.toBe("");
        expect(sink.output).toBe("");
    });

    test("leave without enter emits nothing", () => {
        const sink = collectingSink();
        new Tty(sink, { kitty: false }).leave();
        expect(sink.output).toBe("");
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/tui/src/term/tty.test.ts`
Expected: FAIL — cannot resolve `./tty`.

- [ ] **Step 3: Write the implementation**

`packages/tui/src/term/tty.ts`:

```ts
import type { Sink } from "../render/screen";

interface TtyOptions {
    kitty: boolean;
}

const ALT_SCREEN_ON = "\x1b[?1049h";
const ALT_SCREEN_OFF = "\x1b[?1049l";
const CURSOR_HIDE = "\x1b[?25l";
const CURSOR_SHOW = "\x1b[?25h";
const MOUSE_OFF = "\x1b[?1000l\x1b[?1002l\x1b[?1003l\x1b[?1006l";
const KITTY_PUSH = "\x1b[>1u";
const KITTY_POP = "\x1b[<u";

function enterSequence(opts: TtyOptions): string {
    return `${ALT_SCREEN_ON}${CURSOR_HIDE}${opts.kitty ? KITTY_PUSH : ""}`;
}

function leaveSequence(opts: TtyOptions): string {
    return `${opts.kitty ? KITTY_POP : ""}${MOUSE_OFF}${CURSOR_SHOW}${ALT_SCREEN_OFF}`;
}

class Tty {
    private entered = false;
    private handlersInstalled = false;

    constructor(
        private readonly sink: Sink,
        private readonly opts: TtyOptions,
    ) {}

    enter(): void {
        if (this.entered) return;
        this.entered = true;
        if (process.stdin.isTTY) process.stdin.setRawMode(true);
        this.sink.write(enterSequence(this.opts));
    }

    leave(): void {
        if (!this.entered) return;
        this.entered = false;
        this.sink.write(leaveSequence(this.opts));
        if (process.stdin.isTTY) process.stdin.setRawMode(false);
    }

    installExitHandlers(): void {
        if (this.handlersInstalled) return;
        this.handlersInstalled = true;
        const restore = (): void => {
            this.leave();
        };
        process.on("exit", restore);
        for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
            process.on(signal, () => {
                restore();
                process.exit(signal === "SIGINT" ? 130 : 143);
            });
        }
        process.on("uncaughtException", (err: unknown) => {
            restore();
            console.error(err);
            process.exit(1);
        });
    }
}

export { Tty, enterSequence, leaveSequence };
export type { TtyOptions };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test packages/tui/src/term/tty.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/tui/src/term
git commit -m "feat(tui): add tty setup with guaranteed restoration"
```

---

### Task 6: Legacy key decoder

**Files:**
- Create: `packages/tui/src/input/keys.ts`
- Create: `packages/tui/src/input/decode-legacy.ts`
- Test: `packages/tui/src/input/decode-legacy.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `KeyMods`, `KeyName`, `KeyEvent`, `noMods(): KeyMods`, `modsFromParam(param: number): KeyMods` from `keys.ts`; and `function decodeLegacy(input: string, carry: string): { events: KeyEvent[]; carry: string }` plus `function flushCarry(carry: string): KeyEvent[]` from `decode-legacy.ts`.

Escape sequences split across two reads are normal on a slow pipe, so `carry` returns the unconsumed tail for the next call.

A trailing lone `ESC` is ambiguous: it may begin `ESC [ A` whose remainder has not arrived, or it may be a real Escape press. A pure function over one chunk cannot tell, so `decodeLegacy` holds it and `flushCarry` releases it once the caller's idle timer says no continuation is coming. Skipping `flushCarry` means Escape never registers at all.

- [ ] **Step 1: Write the failing test**

`packages/tui/src/input/decode-legacy.test.ts`:

```ts
import { describe, test, expect } from "bun:test";
import { decodeLegacy, flushCarry } from "./decode-legacy";
import { noMods } from "./keys";

describe("decodeLegacy", () => {
    test("decodes a plain character", () => {
        const { events, carry } = decodeLegacy("a", "");
        expect(events).toEqual([{ name: "char", char: "a", mods: noMods(), kind: "press" }]);
        expect(carry).toBe("");
    });

    test("decodes a control character as ctrl plus letter", () => {
        const { events } = decodeLegacy("\x01", "");
        expect(events[0]).toEqual({
            name: "char",
            char: "a",
            mods: { ...noMods(), ctrl: true },
            kind: "press",
        });
    });

    test("decodes enter, tab and backspace", () => {
        expect(decodeLegacy("\r", "").events[0]?.name).toBe("enter");
        expect(decodeLegacy("\t", "").events[0]?.name).toBe("tab");
        expect(decodeLegacy("\x7f", "").events[0]?.name).toBe("backspace");
    });

    test("decodes a CSI arrow key", () => {
        const { events } = decodeLegacy("\x1b[A", "");
        expect(events[0]).toEqual({ name: "up", mods: noMods(), kind: "press" });
    });

    test("decodes an SS3 arrow key", () => {
        expect(decodeLegacy("\x1bOB", "").events[0]?.name).toBe("down");
    });

    test("decodes a modified CSI arrow key", () => {
        const { events } = decodeLegacy("\x1b[1;5C", "");
        expect(events[0]).toEqual({
            name: "right",
            mods: { ...noMods(), ctrl: true },
            kind: "press",
        });
    });

    test("carries a lone escape rather than emitting it", () => {
        const { events, carry } = decodeLegacy("\x1b", "");
        expect(events).toEqual([]);
        expect(carry).toBe("\x1b");
    });

    test("a carried escape still completes a split sequence", () => {
        const first = decodeLegacy("\x1b", "");
        expect(decodeLegacy("[A", first.carry).events[0]?.name).toBe("up");
    });

    test("flushCarry releases a stranded escape as a real Escape press", () => {
        expect(flushCarry("\x1b")[0]?.name).toBe("escape");
    });

    test("flushCarry drops an incomplete CSI rather than emitting garbage", () => {
        expect(flushCarry("\x1b[1;")).toEqual([]);
    });

    test("decodes alt plus character", () => {
        const { events } = decodeLegacy("\x1bx", "");
        expect(events[0]).toEqual({
            name: "char",
            char: "x",
            mods: { ...noMods(), alt: true },
            kind: "press",
        });
    });

    test("carries an incomplete sequence to the next call", () => {
        const first = decodeLegacy("\x1b[", "");
        expect(first.events).toEqual([]);
        expect(first.carry).toBe("\x1b[");
        const second = decodeLegacy("A", first.carry);
        expect(second.events[0]?.name).toBe("up");
        expect(second.carry).toBe("");
    });

    test("decodes several keys from one chunk", () => {
        const { events } = decodeLegacy("ab\r", "");
        expect(events.map((e) => e.name)).toEqual(["char", "char", "enter"]);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/tui/src/input/decode-legacy.test.ts`
Expected: FAIL — cannot resolve `./keys`.

- [ ] **Step 3: Write `keys.ts`**

```ts
interface KeyMods {
    ctrl: boolean;
    alt: boolean;
    shift: boolean;
    super: boolean;
}

type KeyName =
    | "char"
    | "enter"
    | "escape"
    | "tab"
    | "backspace"
    | "space"
    | "up"
    | "down"
    | "left"
    | "right"
    | "home"
    | "end"
    | "pageup"
    | "pagedown"
    | "delete"
    | "insert";

interface KeyEvent {
    name: KeyName;
    char?: string;
    mods: KeyMods;
    kind: "press" | "repeat" | "release";
}

function noMods(): KeyMods {
    return { ctrl: false, alt: false, shift: false, super: false };
}

/** Decodes an xterm modifier parameter (1 + bitmask) into KeyMods. */
function modsFromParam(param: number): KeyMods {
    const bits = param - 1;
    return {
        shift: (bits & 1) !== 0,
        alt: (bits & 2) !== 0,
        ctrl: (bits & 4) !== 0,
        super: (bits & 8) !== 0,
    };
}

export { noMods, modsFromParam };
export type { KeyEvent, KeyMods, KeyName };
```

- [ ] **Step 4: Write `decode-legacy.ts`**

```ts
import { noMods, modsFromParam, type KeyEvent, type KeyName } from "./keys";

const FINAL_TO_NAME: Record<string, KeyName> = {
    A: "up",
    B: "down",
    C: "right",
    D: "left",
    H: "home",
    F: "end",
};

const TILDE_TO_NAME: Record<number, KeyName> = {
    1: "home",
    2: "insert",
    3: "delete",
    4: "end",
    5: "pageup",
    6: "pagedown",
};

interface DecodeResult {
    events: KeyEvent[];
    carry: string;
}

function press(name: KeyName, mods = noMods(), char?: string): KeyEvent {
    return char === undefined
        ? { name, mods, kind: "press" }
        : { name, char, mods, kind: "press" };
}

function decodeControl(code: number): KeyEvent {
    if (code === 13 || code === 10) return press("enter");
    if (code === 9) return press("tab");
    if (code === 127 || code === 8) return press("backspace");
    if (code === 32) return press("char", noMods(), " ");
    const letter = String.fromCharCode(code + 96);
    return press("char", { ...noMods(), ctrl: true }, letter);
}

/**
 * Decode one read from a legacy terminal. `carry` holds bytes left over from
 * the previous call because they formed an incomplete escape sequence.
 */
function decodeLegacy(input: string, carry: string): DecodeResult {
    const buf = carry + input;
    const events: KeyEvent[] = [];
    let i = 0;

    while (i < buf.length) {
        const ch = buf[i] ?? "";

        if (ch !== "\x1b") {
            const code = ch.charCodeAt(0);
            events.push(code < 32 || code === 127 ? decodeControl(code) : press("char", noMods(), ch));
            i++;
            continue;
        }

        const rest = buf.slice(i);

        if (rest.length === 1) return { events, carry: rest };

        if (rest[1] === "[") {
            const match = /^\x1b\[([0-9;]*)([A-Za-z~])/.exec(rest);
            if (!match) return { events, carry: rest };
            const params = (match[1] ?? "").split(";").filter((p) => p !== "").map(Number);
            const final = match[2] ?? "";
            const mods = params.length > 1 ? modsFromParam(params[1] ?? 1) : noMods();
            if (final === "~") {
                const name = TILDE_TO_NAME[params[0] ?? 0];
                if (name) events.push(press(name, mods));
            } else {
                const name = FINAL_TO_NAME[final];
                if (name) events.push(press(name, mods));
            }
            i += match[0].length;
            continue;
        }

        if (rest[1] === "O") {
            if (rest.length < 3) return { events, carry: rest };
            const name = FINAL_TO_NAME[rest[2] ?? ""];
            if (name) events.push(press(name));
            i += 3;
            continue;
        }

        // ESC followed by a printable character is Alt + that character.
        const next = rest[1] ?? "";
        const code = next.charCodeAt(0);
        if (code >= 32 && code !== 127) {
            events.push(press("char", { ...noMods(), alt: true }, next));
            i += 2;
            continue;
        }

        events.push(press("escape"));
        i++;
    }

    return { events, carry: "" };
}

export { decodeLegacy };
export type { DecodeResult };

/**
 * Convert a carry that has gone stale into events. `decodeLegacy` cannot know
 * whether a trailing ESC starts a longer sequence or is a real Escape press, so
 * it holds it; the caller calls this after a short idle timeout to release it.
 */
function flushCarry(carry: string): KeyEvent[] {
    if (carry === "") return [];
    if (carry === "\x1b") return [press("escape")];
    // A partial CSI/SS3 that never completed: drop it rather than emit garbage.
    return [];
}

export { flushCarry };
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `bun test packages/tui/src/input/decode-legacy.test.ts`
Expected: PASS, 12 tests.

- [ ] **Step 6: Commit**

```bash
git add packages/tui/src/input
git commit -m "feat(tui): add legacy key decoder"
```

---

### Task 7: Kitty key decoder and protocol negotiation

**Files:**
- Create: `packages/tui/src/input/decode-kitty.ts`
- Create: `packages/tui/src/input/negotiate.ts`
- Test: `packages/tui/src/input/decode-kitty.test.ts`
- Test: `packages/tui/src/input/negotiate.test.ts`

**Interfaces:**
- Consumes: `KeyEvent`, `noMods`, `modsFromParam` (Task 6); `decodeLegacy`, `DecodeResult` (Task 6).
- Produces: `function decodeKitty(input: string, carry: string): DecodeResult` and `function negotiateKitty(io: { write(data: string): void; waitForData(timeoutMs: number): Promise<string> }, timeoutMs?: number): Promise<boolean>`.

With flags `1` (disambiguate escape codes) the terminal keeps legacy encodings for most keys and switches ambiguous ones to `CSI ... u`. So `decodeKitty` handles only `u`-final sequences and delegates everything else to `decodeLegacy`.

`CSI <codepoint> ; <modifiers> : <event-type> u`, where modifiers is `1 + bitmask` and event-type is `1` press, `2` repeat, `3` release. `Ctrl+Esc` is therefore `\x1b[27;5u`.

- [ ] **Step 1: Write the failing tests**

`packages/tui/src/input/decode-kitty.test.ts`:

```ts
import { describe, test, expect } from "bun:test";
import { decodeKitty } from "./decode-kitty";
import { noMods } from "./keys";

describe("decodeKitty", () => {
    test("decodes ctrl+escape, the focus switcher", () => {
        const { events } = decodeKitty("\x1b[27;5u", "");
        expect(events[0]).toEqual({
            name: "escape",
            mods: { ...noMods(), ctrl: true },
            kind: "press",
        });
    });

    test("decodes a bare character codepoint", () => {
        const { events } = decodeKitty("\x1b[97u", "");
        expect(events[0]).toEqual({ name: "char", char: "a", mods: noMods(), kind: "press" });
    });

    test("decodes shift+enter", () => {
        const { events } = decodeKitty("\x1b[13;2u", "");
        expect(events[0]).toEqual({
            name: "enter",
            mods: { ...noMods(), shift: true },
            kind: "press",
        });
    });

    test("decodes the event type when present", () => {
        expect(decodeKitty("\x1b[97;1:3u", "").events[0]?.kind).toBe("release");
        expect(decodeKitty("\x1b[97;1:2u", "").events[0]?.kind).toBe("repeat");
    });

    test("delegates non-u sequences to the legacy decoder", () => {
        expect(decodeKitty("\x1b[A", "").events[0]?.name).toBe("up");
        expect(decodeKitty("q", "").events[0]?.char).toBe("q");
    });

    test("keeps both keys when a chunk mixes legacy and kitty input", () => {
        // A single read can contain both; delegating the whole tail to the
        // legacy decoder silently swallowed the CSI-u sequence.
        const { events } = decodeKitty("q\x1b[13;2u", "");
        expect(events.map((e) => e.name)).toEqual(["char", "enter"]);
    });

    test("carries an incomplete u sequence", () => {
        const first = decodeKitty("\x1b[27;", "");
        expect(first.events).toEqual([]);
        expect(first.carry).toBe("\x1b[27;");
        expect(decodeKitty("5u", first.carry).events[0]?.name).toBe("escape");
    });
});
```

`packages/tui/src/input/negotiate.test.ts`:

```ts
import { describe, test, expect } from "bun:test";
import { negotiateKitty } from "./negotiate";

describe("negotiateKitty", () => {
    test("reports support when the terminal replies with flags", async () => {
        const written: string[] = [];
        const supported = await negotiateKitty({
            write: (data) => written.push(data),
            waitForData: () => Promise.resolve("\x1b[?1u"),
        });
        expect(supported).toBe(true);
        expect(written).toContain("\x1b[?u");
    });

    test("reports no support when the reply times out", async () => {
        const supported = await negotiateKitty({
            write: () => undefined,
            waitForData: () => Promise.resolve(""),
        });
        expect(supported).toBe(false);
    });

    test("reports no support for an unrelated reply", async () => {
        const supported = await negotiateKitty({
            write: () => undefined,
            waitForData: () => Promise.resolve("\x1b[?62;c"),
        });
        expect(supported).toBe(false);
    });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test packages/tui/src/input/decode-kitty.test.ts packages/tui/src/input/negotiate.test.ts`
Expected: FAIL — cannot resolve `./decode-kitty`.

- [ ] **Step 3: Write `decode-kitty.ts`**

```ts
import { decodeLegacy, type DecodeResult } from "./decode-legacy";
import { modsFromParam, type KeyEvent, type KeyName } from "./keys";

const CODEPOINT_TO_NAME: Record<number, KeyName> = {
    13: "enter",
    27: "escape",
    9: "tab",
    127: "backspace",
    32: "space",
};

const KITTY_SEQUENCE = /^\x1b\[([0-9;:]*)u/;
const INCOMPLETE_CSI = /^\x1b(\[[0-9;:]*)?$/;

/** Index of the next kitty `u` sequence at or after offset 1, or -1. */
function findNextKitty(buf: string): number {
    for (let i = 1; i < buf.length; i++) {
        if (buf[i] === "\x1b" && KITTY_SEQUENCE.test(buf.slice(i))) return i;
    }
    return -1;
}

function eventKind(value: number | undefined): KeyEvent["kind"] {
    if (value === 2) return "repeat";
    if (value === 3) return "release";
    return "press";
}

/**
 * Decode one read from a terminal with the kitty keyboard protocol pushed.
 * Only `u`-final sequences are kitty-specific; everything else keeps its
 * legacy encoding under flag 1, so it is delegated.
 */
function decodeKitty(input: string, carry: string): DecodeResult {
    const buf = carry + input;
    const events: KeyEvent[] = [];
    let rest = buf;

    while (rest.length > 0) {
        const match = KITTY_SEQUENCE.exec(rest);
        if (match) {
            const fields = (match[1] ?? "").split(";");
            const codepoint = Number.parseInt(fields[0] ?? "", 10);
            const modField = (fields[1] ?? "1").split(":");
            const mods = modsFromParam(Number.parseInt(modField[0] ?? "1", 10) || 1);
            const kind = eventKind(Number.parseInt(modField[1] ?? "1", 10));

            if (Number.isInteger(codepoint)) {
                const name = CODEPOINT_TO_NAME[codepoint];
                events.push(
                    name === undefined
                        ? { name: "char", char: String.fromCodePoint(codepoint), mods, kind }
                        : { name, mods, kind },
                );
            }
            rest = rest.slice(match[0].length);
            continue;
        }

        if (INCOMPLETE_CSI.test(rest)) return { events, carry: rest };

        // Not a kitty sequence here. Decode legacy input only up to the next
        // kitty sequence, so a chunk mixing both kinds keeps all of its keys.
        const nextKitty = findNextKitty(rest);
        const chunk = nextKitty === -1 ? rest : rest.slice(0, nextKitty);
        const legacy = decodeLegacy(chunk, "");
        events.push(...legacy.events);
        if (nextKitty === -1) return { events, carry: legacy.carry };
        rest = rest.slice(nextKitty);
    }

    return { events, carry: "" };
}

export { decodeKitty };
```

- [ ] **Step 4: Write `negotiate.ts`**

```ts
interface NegotiateIo {
    write(data: string): void;
    waitForData(timeoutMs: number): Promise<string>;
}

const QUERY = "\x1b[?u";
const REPLY = /\x1b\[\?[0-9]+u/;
const DEFAULT_TIMEOUT_MS = 150;

/**
 * Ask the outer terminal whether it speaks the kitty keyboard protocol.
 * A terminal that does replies `CSI ? <flags> u`; one that does not stays
 * silent, so the timeout is the negative answer.
 */
async function negotiateKitty(io: NegotiateIo, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<boolean> {
    io.write(QUERY);
    const reply = await io.waitForData(timeoutMs);
    return REPLY.test(reply);
}

export { negotiateKitty };
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `bun test packages/tui/src/input/`
Expected: PASS, 22 tests across the three input test files.

- [ ] **Step 6: Commit**

```bash
git add packages/tui/src/input
git commit -m "feat(tui): add kitty key decoder and protocol negotiation"
```

---

### Task 8: Per-child key encoding

**Files:**
- Create: `packages/tui/src/input/encode.ts`
- Test: `packages/tui/src/input/encode.test.ts`

**Interfaces:**
- Consumes: `KeyEvent`, `KeyMods` (Task 6).
- Produces: `interface ChildModes { applicationCursorKeys: boolean; bracketedPaste: boolean; kittyFlags: number | null }`, `function encodeForChild(ev: KeyEvent, modes: ChildModes): string`, `function encodePaste(text: string, modes: ChildModes): string`.

The child's modes decide the encoding, which is why every session keeps its own terminal (spec, Encode per session). `kittyFlags` is non-null only when the child itself pushed the protocol.

- [ ] **Step 1: Write the failing test**

`packages/tui/src/input/encode.test.ts`:

```ts
import { describe, test, expect } from "bun:test";
import { encodeForChild, encodePaste, type ChildModes } from "./encode";
import { noMods, type KeyEvent } from "./keys";

const legacy: ChildModes = {
    applicationCursorKeys: false,
    bracketedPaste: false,
    kittyFlags: null,
};

function key(patch: Partial<KeyEvent>): KeyEvent {
    return { name: "char", mods: noMods(), kind: "press", ...patch };
}

describe("encodeForChild", () => {
    test("encodes a plain character as itself", () => {
        expect(encodeForChild(key({ name: "char", char: "a" }), legacy)).toBe("a");
    });

    test("encodes ctrl plus letter as a control byte", () => {
        const ev = key({ name: "char", char: "c", mods: { ...noMods(), ctrl: true } });
        expect(encodeForChild(ev, legacy)).toBe("\x03");
    });

    test("encodes alt plus character with an escape prefix", () => {
        const ev = key({ name: "char", char: "b", mods: { ...noMods(), alt: true } });
        expect(encodeForChild(ev, legacy)).toBe("\x1bb");
    });

    test("encodes arrows as CSI by default", () => {
        expect(encodeForChild(key({ name: "up" }), legacy)).toBe("\x1b[A");
    });

    test("encodes arrows as SS3 under application cursor keys mode", () => {
        const modes = { ...legacy, applicationCursorKeys: true };
        expect(encodeForChild(key({ name: "up" }), modes)).toBe("\x1bOA");
    });

    test("keeps CSI form for a modified arrow even in application mode", () => {
        const modes = { ...legacy, applicationCursorKeys: true };
        const ev = key({ name: "right", mods: { ...noMods(), ctrl: true } });
        expect(encodeForChild(ev, modes)).toBe("\x1b[1;5C");
    });

    test("encodes enter, tab, backspace and escape", () => {
        expect(encodeForChild(key({ name: "enter" }), legacy)).toBe("\r");
        expect(encodeForChild(key({ name: "tab" }), legacy)).toBe("\t");
        expect(encodeForChild(key({ name: "backspace" }), legacy)).toBe("\x7f");
        expect(encodeForChild(key({ name: "escape" }), legacy)).toBe("\x1b");
    });

    test("encodes CSI u when the child pushed the kitty protocol", () => {
        const modes = { ...legacy, kittyFlags: 1 };
        const ev = key({ name: "enter", mods: { ...noMods(), shift: true } });
        expect(encodeForChild(ev, modes)).toBe("\x1b[13;2u");
    });

    test("keeps plain text literal under flag 1", () => {
        const modes = { ...legacy, kittyFlags: 1 };
        expect(encodeForChild(key({ name: "char", char: "a" }), modes)).toBe("a");
    });

    test("sends Ctrl+C as CSI u under flag 1, not as an interrupt byte", () => {
        // Per the kitty spec, flag 1 means "ctrl+c will no longer generate the
        // SIGINT signal, but instead be delivered as a CSI u escape code".
        const modes = { ...legacy, kittyFlags: 1 };
        const ev = key({ name: "char", char: "c", mods: { ...noMods(), ctrl: true } });
        expect(encodeForChild(ev, modes)).toBe("\x1b[99;5u");
    });

    test("sends Alt+key and Escape as CSI u under flag 1", () => {
        const modes = { ...legacy, kittyFlags: 1 };
        const alt = key({ name: "char", char: "a", mods: { ...noMods(), alt: true } });
        expect(encodeForChild(alt, modes)).toBe("\x1b[97;3u");
        expect(encodeForChild(key({ name: "escape" }), modes)).toBe("\x1b[27u");
    });

    test("keeps Enter legacy under flag 1, for shell compatibility", () => {
        const modes = { ...legacy, kittyFlags: 1 };
        expect(encodeForChild(key({ name: "enter" }), modes)).toBe("\r");
    });

    test("uses CSI u under flag 8, which asks for all keys as escape codes", () => {
        const modes = { ...legacy, kittyFlags: 8 };
        expect(encodeForChild(key({ name: "char", char: "a" }), modes)).toBe("\x1b[97u");
    });

    test("drops a release when the child did not request event types", () => {
        const modes = { ...legacy, kittyFlags: 1 };
        const ev = key({ name: "char", char: "a", kind: "release" });
        expect(encodeForChild(ev, modes)).toBe("");
    });

    test("drops release events for a child that did not ask for them", () => {
        expect(encodeForChild(key({ name: "char", char: "a", kind: "release" }), legacy)).toBe("");
    });
});

describe("encodePaste", () => {
    test("wraps the text when bracketed paste is enabled", () => {
        const modes = { ...legacy, bracketedPaste: true };
        expect(encodePaste("hi", modes)).toBe("\x1b[200~hi\x1b[201~");
    });

    test("sends the text bare when bracketed paste is disabled", () => {
        expect(encodePaste("hi", legacy)).toBe("hi");
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/tui/src/input/encode.test.ts`
Expected: FAIL — cannot resolve `./encode`.

- [ ] **Step 3: Write the implementation**

`packages/tui/src/input/encode.ts`:

```ts
import type { KeyEvent, KeyMods, KeyName } from "./keys";

interface ChildModes {
    applicationCursorKeys: boolean;
    bracketedPaste: boolean;
    kittyFlags: number | null;
}

const ARROW_FINALS: Partial<Record<KeyName, string>> = {
    up: "A",
    down: "B",
    right: "C",
    left: "D",
    home: "H",
    end: "F",
};

const TILDE_CODES: Partial<Record<KeyName, number>> = {
    insert: 2,
    delete: 3,
    pageup: 5,
    pagedown: 6,
};

const SIMPLE: Partial<Record<KeyName, string>> = {
    enter: "\r",
    tab: "\t",
    backspace: "\x7f",
    escape: "\x1b",
    space: " ",
};

const KITTY_CODEPOINTS: Partial<Record<KeyName, number>> = {
    enter: 13,
    escape: 27,
    tab: 9,
    backspace: 127,
    space: 32,
};

function modParam(mods: KeyMods): number {
    return (
        1 +
        (mods.shift ? 1 : 0) +
        (mods.alt ? 2 : 0) +
        (mods.ctrl ? 4 : 0) +
        (mods.super ? 8 : 0)
    );
}

function hasModifier(mods: KeyMods): boolean {
    return mods.ctrl || mods.alt || mods.shift || mods.super;
}

const KITTY_REPORT_EVENT_TYPES = 2;
const KITTY_REPORT_ALL_KEYS = 8;

/**
 * Which keys flag 1 ("disambiguate escape codes") moves to CSI u. Per the kitty
 * protocol spec: "the terminal will report the Esc, alt+key, ctrl+key,
 * ctrl+alt+key, shift+alt+key keys using CSI u sequences instead of legacy
 * ones", and "ctrl+c will no longer generate the SIGINT signal, but instead be
 * delivered as a CSI u escape code". Plain text stays literal, and Enter, Tab
 * and Backspace keep their legacy bytes for shell compatibility.
 */
function needsKittyEncoding(ev: KeyEvent): boolean {
    if (ev.mods.ctrl || ev.mods.alt || ev.mods.super) return true;
    if (ev.name === "escape") return true;
    // Unmodified these stay legacy; their shifted forms have no legacy encoding.
    if (ev.name === "enter" || ev.name === "tab" || ev.name === "backspace") {
        return ev.mods.shift;
    }
    return false;
}

function encodeKitty(ev: KeyEvent, modes: ChildModes, flags: number): string {
    if (ev.kind !== "press" && (flags & KITTY_REPORT_EVENT_TYPES) === 0) return "";

    const forceAll = (flags & KITTY_REPORT_ALL_KEYS) !== 0;
    if (!forceAll && !needsKittyEncoding(ev)) return encodeLegacy(ev, modes);

    const codepoint =
        ev.name === "char" ? (ev.char?.codePointAt(0) ?? 0) : (KITTY_CODEPOINTS[ev.name] ?? 0);
    if (codepoint === 0) return encodeLegacy(ev, modes);

    const param = modParam(ev.mods);
    const reportsEvents = (flags & KITTY_REPORT_EVENT_TYPES) !== 0;
    const kindSuffix =
        reportsEvents && ev.kind !== "press" ? `:${ev.kind === "repeat" ? "2" : "3"}` : "";
    if (param === 1 && kindSuffix === "") return `\x1b[${String(codepoint)}u`;
    return `\x1b[${String(codepoint)};${String(param)}${kindSuffix}u`;
}

function encodeLegacy(ev: KeyEvent, modes: { applicationCursorKeys: boolean }): string {
    const arrow = ARROW_FINALS[ev.name];
    if (arrow !== undefined) {
        if (hasModifier(ev.mods)) return `\x1b[1;${String(modParam(ev.mods))}${arrow}`;
        return modes.applicationCursorKeys ? `\x1bO${arrow}` : `\x1b[${arrow}`;
    }

    const tilde = TILDE_CODES[ev.name];
    if (tilde !== undefined) {
        if (hasModifier(ev.mods)) return `\x1b[${String(tilde)};${String(modParam(ev.mods))}~`;
        return `\x1b[${String(tilde)}~`;
    }

    const simple = SIMPLE[ev.name];
    if (simple !== undefined) return ev.mods.alt ? `\x1b${simple}` : simple;

    const char = ev.char;
    if (char === undefined) return "";

    if (ev.mods.ctrl) {
        const lower = char.toLowerCase();
        const code = lower.charCodeAt(0);
        if (code >= 97 && code <= 122) {
            const control = String.fromCharCode(code - 96);
            return ev.mods.alt ? `\x1b${control}` : control;
        }
    }

    return ev.mods.alt ? `\x1b${char}` : char;
}

function encodeForChild(ev: KeyEvent, modes: ChildModes): string {
    if (modes.kittyFlags === null && ev.kind !== "press") return "";
    if (modes.kittyFlags !== null) return encodeKitty(ev, modes, modes.kittyFlags);
    return encodeLegacy(ev, modes);
}

function encodePaste(text: string, modes: ChildModes): string {
    return modes.bracketedPaste ? `\x1b[200~${text}\x1b[201~` : text;
}

export { encodeForChild, encodePaste };
export type { ChildModes };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test packages/tui/src/input/encode.test.ts`
Expected: PASS, 17 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/tui/src/input
git commit -m "feat(tui): encode key events per child terminal modes"
```

---

### Task 9: Session terminal — attach, resync and mode tracking

**Files:**
- Create: `packages/tui/src/term/session-terminal.ts`
- Test: `packages/tui/src/term/session-terminal.test.ts`

**Interfaces:**
- Consumes: `NetLike` (Task 1); `ChildModes` (Task 8).
- Produces: `interface SessionOwner { taskId?: string; projectId?: string; master?: boolean }` and `class SessionTerminal` with `constructor(deps: { net: NetLike; sessionId: string; owner: SessionOwner; cols: number; rows: number })`, `attach(): Promise<void>`, `resize(cols: number, rows: number): void`, `readonly terminal: Terminal`, `get modes(): ChildModes`, `get cursorHidden(): boolean`, `dispose(): void`.

This is a port of `packages/ui/src/components/panes/terminal/terminal-lifecycle.ts:266-308`. The ordering matters: output events can arrive before the snapshot request resolves, and those must be replayed in order and filtered by `sequence > lastSequence`.

Cursor visibility is not exposed by `IBuffer`, so DECTCEM is tracked with a parser handler. The kitty protocol state the child pushes is tracked the same way (spec, Encode per session).

- [ ] **Step 1: Write the failing test**

`packages/tui/src/term/session-terminal.test.ts`:

```ts
import { describe, test, expect } from "bun:test";
import { MSG } from "@taskflow/shared";
import { SessionTerminal } from "./session-terminal";
import type { NetLike } from "../net/client";

interface FakeNet extends NetLike {
    emit(type: string, payload: unknown): void;
    requests: Array<{ type: string; payload: unknown }>;
}

function fakeNet(responses: Record<string, unknown>): FakeNet {
    const listeners = new Map<string, Set<(payload: unknown) => void>>();
    return {
        requests: [],
        request<T>(type: string, payload?: unknown): Promise<T> {
            this.requests.push({ type, payload });
            const response = responses[type];
            if (response === undefined) return Promise.reject(new Error(`no stub for ${type}`));
            return Promise.resolve(response as T);
        },
        onStatusChange: () => () => undefined,
        on(type: string, handler: (payload: unknown) => void): () => void {
            let set = listeners.get(type);
            if (!set) {
                set = new Set();
                listeners.set(type, set);
            }
            set.add(handler);
            return () => {
                set.delete(handler);
            };
        },
        emit(type: string, payload: unknown): void {
            for (const handler of listeners.get(type) ?? []) handler(payload);
        },
    };
}

function readRow(term: SessionTerminal, y: number): string {
    return term.terminal.buffer.active.getLine(y)?.translateToString(true) ?? "";
}

/** Modes are set by the child's output stream, which is still queued. */
async function settle(): Promise<void> {
    await Bun.sleep(30);
}

describe("SessionTerminal", () => {
    test("restores from a snapshot when one is available", async () => {
        const net = fakeNet({
            [MSG.SESSION_SNAPSHOT]: { snapshot: "HELLO", lastSequence: 5, cursorHidden: false },
        });
        const term = new SessionTerminal({ net, sessionId: "s1", owner: {}, cols: 20, rows: 5 });
        await term.attach();
        expect(readRow(term, 0)).toBe("HELLO");
        term.dispose();
    });

    test("falls back to history when there is no snapshot", async () => {
        const net = fakeNet({
            [MSG.SESSION_SNAPSHOT]: { snapshot: null, lastSequence: 0, cursorHidden: false },
            [MSG.SESSION_HISTORY]: { data: "FROMLOG", lastSequence: 2 },
        });
        const term = new SessionTerminal({ net, sessionId: "s1", owner: {}, cols: 20, rows: 5 });
        await term.attach();
        expect(readRow(term, 0)).toBe("FROMLOG");
        term.dispose();
    });

    test("replays buffered output that arrived before the snapshot, skipping stale chunks", async () => {
        let release = (): void => undefined;
        const gate = new Promise<void>((resolve) => {
            release = resolve;
        });
        const net = fakeNet({});
        net.request = <T,>(type: string): Promise<T> => {
            if (type === MSG.SESSION_SNAPSHOT) {
                return gate.then(
                    () =>
                        ({ snapshot: "AAA", lastSequence: 5, cursorHidden: false }) as unknown as T,
                );
            }
            return Promise.reject(new Error(`no stub for ${type}`));
        };

        const term = new SessionTerminal({ net, sessionId: "s1", owner: {}, cols: 20, rows: 5 });
        const attached = term.attach();
        net.emit(MSG.TERMINAL_OUTPUT, { sessionId: "s1", data: "STALE", sequence: 4 });
        net.emit(MSG.TERMINAL_OUTPUT, { sessionId: "s1", data: "BBB", sequence: 6 });
        release();
        await attached;
        expect(readRow(term, 0)).toBe("AAABBB");
        term.dispose();
    });

    test("ignores output belonging to other sessions", async () => {
        const net = fakeNet({
            [MSG.SESSION_SNAPSHOT]: { snapshot: "", lastSequence: 0, cursorHidden: false },
        });
        const term = new SessionTerminal({ net, sessionId: "s1", owner: {}, cols: 20, rows: 5 });
        await term.attach();
        net.emit(MSG.TERMINAL_OUTPUT, { sessionId: "other", data: "NOPE", sequence: 1 });
        await settle();
        expect(readRow(term, 0)).toBe("");
        term.dispose();
    });

    test("tracks application cursor keys and bracketed paste from child output", async () => {
        const net = fakeNet({
            [MSG.SESSION_SNAPSHOT]: { snapshot: "", lastSequence: 0, cursorHidden: false },
        });
        const term = new SessionTerminal({ net, sessionId: "s1", owner: {}, cols: 20, rows: 5 });
        await term.attach();
        expect(term.modes.applicationCursorKeys).toBe(false);
        net.emit(MSG.TERMINAL_OUTPUT, {
            sessionId: "s1",
            data: "\x1b[?1h\x1b[?2004h",
            sequence: 1,
        });
        await settle();
        expect(term.modes.applicationCursorKeys).toBe(true);
        expect(term.modes.bracketedPaste).toBe(true);
        term.dispose();
    });

    test("tracks the kitty protocol flags the child pushes and pops", async () => {
        const net = fakeNet({
            [MSG.SESSION_SNAPSHOT]: { snapshot: "", lastSequence: 0, cursorHidden: false },
        });
        const term = new SessionTerminal({ net, sessionId: "s1", owner: {}, cols: 20, rows: 5 });
        await term.attach();
        expect(term.modes.kittyFlags).toBeNull();
        net.emit(MSG.TERMINAL_OUTPUT, { sessionId: "s1", data: "\x1b[>1u", sequence: 1 });
        await settle();
        expect(term.modes.kittyFlags).toBe(1);
        net.emit(MSG.TERMINAL_OUTPUT, { sessionId: "s1", data: "\x1b[<u", sequence: 2 });
        await settle();
        expect(term.modes.kittyFlags).toBeNull();
        term.dispose();
    });

    test("tracks cursor visibility", async () => {
        const net = fakeNet({
            [MSG.SESSION_SNAPSHOT]: { snapshot: "", lastSequence: 0, cursorHidden: false },
        });
        const term = new SessionTerminal({ net, sessionId: "s1", owner: {}, cols: 20, rows: 5 });
        await term.attach();
        expect(term.cursorHidden).toBe(false);
        net.emit(MSG.TERMINAL_OUTPUT, { sessionId: "s1", data: "\x1b[?25l", sequence: 1 });
        await settle();
        expect(term.cursorHidden).toBe(true);
        term.dispose();
    });

    test("writes a process-exited marker when the session ends", async () => {
        const net = fakeNet({
            [MSG.SESSION_SNAPSHOT]: { snapshot: "", lastSequence: 0, cursorHidden: false },
        });
        const term = new SessionTerminal({ net, sessionId: "s1", owner: {}, cols: 40, rows: 5 });
        await term.attach();
        net.emit(MSG.SESSION_EXITED, { sessionId: "s1", exitCode: 3 });
        await settle();
        const text = [0, 1, 2].map((y) => readRow(term, y)).join("");
        expect(text).toContain("[Process exited with code 3]");
        term.dispose();
    });

    test("ignores an exit belonging to another session", async () => {
        const net = fakeNet({
            [MSG.SESSION_SNAPSHOT]: { snapshot: "", lastSequence: 0, cursorHidden: false },
        });
        const term = new SessionTerminal({ net, sessionId: "s1", owner: {}, cols: 40, rows: 5 });
        await term.attach();
        net.emit(MSG.SESSION_EXITED, { sessionId: "other", exitCode: 1 });
        await settle();
        const text = [0, 1, 2].map((y) => readRow(term, y)).join("");
        expect(text).not.toContain("Process exited");
        term.dispose();
    });

    test("re-attaching replaces the screen instead of appending to it", async () => {
        // What Task 18 does on reconnect. Without the reset, the snapshot is
        // drawn on top of the old grid and everything appears twice.
        const net = fakeNet({
            [MSG.SESSION_SNAPSHOT]: { snapshot: "PROMPT>", lastSequence: 0, cursorHidden: false },
        });
        const term = new SessionTerminal({ net, sessionId: "s1", owner: {}, cols: 20, rows: 5 });
        await term.attach();
        await term.attach();
        expect([0, 1, 2].map((y) => readRow(term, y)).join("")).toBe("PROMPT>");
        term.dispose();
    });

    test("re-attaching preserves modes the child set before the drop", async () => {
        const net = fakeNet({
            [MSG.SESSION_SNAPSHOT]: { snapshot: "", lastSequence: 0, cursorHidden: false },
        });
        const term = new SessionTerminal({ net, sessionId: "s1", owner: {}, cols: 20, rows: 5 });
        await term.attach();
        net.emit(MSG.TERMINAL_OUTPUT, {
            sessionId: "s1",
            data: "\x1b[?1h\x1b[?2004h",
            sequence: 1,
        });
        await settle();
        await term.attach();
        expect(term.modes.applicationCursorKeys).toBe(true);
        expect(term.modes.bracketedPaste).toBe(true);
        term.dispose();
    });

    test("sends a resize request and resizes the local grid", async () => {
        const net = fakeNet({
            [MSG.SESSION_SNAPSHOT]: { snapshot: "", lastSequence: 0, cursorHidden: false },
            [MSG.TERMINAL_RESIZE]: { success: true },
        });
        const term = new SessionTerminal({ net, sessionId: "s1", owner: {}, cols: 20, rows: 5 });
        await term.attach();
        term.resize(40, 10);
        expect(term.terminal.cols).toBe(40);
        expect(net.requests.some((r) => r.type === MSG.TERMINAL_RESIZE)).toBe(true);
        term.dispose();
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/tui/src/term/session-terminal.test.ts`
Expected: FAIL — cannot resolve `./session-terminal`.

- [ ] **Step 3: Write the implementation**

`packages/tui/src/term/session-terminal.ts`:

```ts
import { Terminal } from "@xterm/headless";
import { MSG } from "@taskflow/shared";
import type {
    SessionSnapshotResponse,
    SessionHistoryResponse,
    TerminalOutputEvent,
    SessionExitedEvent,
} from "@taskflow/shared";
import type { NetLike } from "../net/client";
import type { ChildModes } from "../input/encode";

interface SessionOwner {
    taskId?: string;
    projectId?: string;
    master?: boolean;
}

interface SessionTerminalDeps {
    net: NetLike;
    sessionId: string;
    owner: SessionOwner;
    cols: number;
    rows: number;
}

interface PendingChunk {
    data: string;
    sequence: number;
}

class SessionTerminal {
    public readonly terminal: Terminal;

    private historyLoaded = false;
    private pending: PendingChunk[] = [];
    private kittyFlags: number | null = null;
    private hiddenCursor = false;
    private readonly disposers: Array<() => void> = [];
    /** Serializes writes so `attach()` can await the parser actually finishing. */
    private writeQueue: Promise<void> = Promise.resolve();

    constructor(private readonly deps: SessionTerminalDeps) {
        this.terminal = new Terminal({
            cols: deps.cols,
            rows: deps.rows,
            allowProposedApi: true,
            scrollback: 5000,
        });

        this.registerModeHandlers();

        this.disposers.push(
            deps.net.on(MSG.TERMINAL_OUTPUT, (payload) => {
                const event = payload as TerminalOutputEvent;
                if (event.sessionId !== deps.sessionId) return;
                if (this.historyLoaded) void this.enqueue(event.data);
                else this.pending.push({ data: event.data, sequence: event.sequence });
            }),
        );

        this.disposers.push(
            deps.net.on(MSG.SESSION_EXITED, (payload) => {
                const event = payload as SessionExitedEvent;
                if (event.sessionId !== deps.sessionId) return;
                void this.enqueue(
                    `\r\n\x1b[90m[Process exited with code ${String(event.exitCode)}]\x1b[0m\r\n`,
                );
            }),
        );
    }

    private registerModeHandlers(): void {
        const parser = this.terminal.parser;

        // The child pushing or popping the kitty keyboard protocol.
        const track = (disposable: { dispose(): void }): void => {
            this.disposers.push(() => disposable.dispose());
        };

        track(
            parser.registerCsiHandler({ prefix: ">", final: "u" }, (params) => {
                const first = params[0];
                this.kittyFlags = typeof first === "number" ? first : 1;
                return false;
            }),
        );
        track(
            parser.registerCsiHandler({ prefix: "<", final: "u" }, () => {
                this.kittyFlags = null;
                return false;
            }),
        );

        // DECTCEM — cursor visibility, which IBuffer does not expose.
        const setCursorVisible = (visible: boolean) => (params: (number | number[])[]) => {
            if (params.some((p) => p === 25)) this.hiddenCursor = !visible;
            return false;
        };
        track(parser.registerCsiHandler({ prefix: "?", final: "h" }, setCursorVisible(true)));
        track(parser.registerCsiHandler({ prefix: "?", final: "l" }, setCursorVisible(false)));
    }

    /**
     * `Terminal.write` is asynchronous and reports completion by callback.
     * Queueing through it keeps writes ordered and lets `attach()` resolve only
     * once the parser has consumed everything.
     */
    private enqueue(data: string): Promise<void> {
        this.writeQueue = this.writeQueue.then(
            () => new Promise<void>((resolve) => this.terminal.write(data, resolve)),
        );
        return this.writeQueue;
    }

    get modes(): ChildModes {
        return {
            applicationCursorKeys: this.terminal.modes.applicationCursorKeysMode,
            bracketedPaste: this.terminal.modes.bracketedPasteMode,
            kittyFlags: this.kittyFlags,
        };
    }

    get cursorHidden(): boolean {
        return this.hiddenCursor;
    }

    async attach(): Promise<void> {
        // A second attach means the connection dropped and came back. The
        // snapshot is the entire screen, so the old grid must go first or it
        // renders twice. terminal.reset() also clears DEC modes, which the
        // child set long ago and will not send again, so they are restored.
        if (this.historyLoaded) {
            const previous = this.modes;
            this.historyLoaded = false;
            this.pending = [];
            this.terminal.reset();
            let restore = "";
            if (previous.applicationCursorKeys) restore += "\x1b[?1h";
            if (previous.bracketedPaste) restore += "\x1b[?2004h";
            if (restore !== "") await this.enqueue(restore);
        }

        try {
            const snapshot = await this.deps.net.request<SessionSnapshotResponse>(
                MSG.SESSION_SNAPSHOT,
                { sessionId: this.deps.sessionId },
            );
            if (snapshot.snapshot !== null) {
                void this.enqueue(snapshot.snapshot);
                if (snapshot.cursorHidden) {
                    void this.enqueue("\x1b[?25l");
                    this.hiddenCursor = true;
                }
                await this.finishLoad(snapshot.lastSequence);
                return;
            }
        } catch {
            // Fall through to history.
        }

        try {
            const history = await this.deps.net.request<SessionHistoryResponse>(
                MSG.SESSION_HISTORY,
                { ...this.deps.owner, sessionId: this.deps.sessionId },
            );
            if (history.data) void this.enqueue(history.data);
            await this.finishLoad(history.lastSequence);
        } catch {
            await this.finishLoad(-1);
        }
    }

    private async finishLoad(lastSequence: number): Promise<void> {
        this.historyLoaded = true;
        for (const chunk of this.pending) {
            if (chunk.sequence > lastSequence) void this.enqueue(chunk.data);
        }
        this.pending = [];
        await this.writeQueue;
    }

    resize(cols: number, rows: number): void {
        this.terminal.resize(cols, rows);
        void this.deps.net
            .request(MSG.TERMINAL_RESIZE, { sessionId: this.deps.sessionId, cols, rows })
            .catch(() => undefined);
    }

    dispose(): void {
        for (const dispose of this.disposers) dispose();
        this.disposers.length = 0;
        this.terminal.dispose();
    }
}

export { SessionTerminal };
export type { SessionOwner };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test packages/tui/src/term/session-terminal.test.ts`
Expected: PASS, 12 tests.

The `registerCsiHandler` approach here is verified, not assumed: with `prefix` set to `>`, `<`, and `?`, all four handlers fire and `params` arrives as `[1]`, `[0]`, `[25]` and `[1]` respectively, while `terminal.modes` tracks the DEC modes in parallel.

`attach()` resolves only once the parser has consumed every queued write, so tests read the buffer immediately after awaiting it. Do not reintroduce a sleep to paper over an ordering bug.

- [ ] **Step 5: Commit**

```bash
git add packages/tui/src/term
git commit -m "feat(tui): attach to sessions with snapshot and history resync"
```

---

### Task 10: Blit a terminal buffer into the screen

**Files:**
- Create: `packages/tui/src/term/blit.ts`
- Test: `packages/tui/src/term/blit.test.ts`

**Interfaces:**
- Consumes: `ScreenBuffer`, `Cell`, `Color`, `ATTR_*` (Task 3); `SessionTerminal` (Task 9).
- Produces: `function blitTerminal(source: SessionTerminal, buf: ScreenBuffer, x0: number, y0: number, cols: number, rows: number): { x: number; y: number } | null` — returns the cursor position in screen coordinates, or `null` when the cursor is hidden.

A palette index must survive as a palette index. Converting it to RGB here would silently break Omarchy theme switching, so that is an explicit test.

- [ ] **Step 1: Write the failing test**

`packages/tui/src/term/blit.test.ts`:

```ts
import { describe, test, expect } from "bun:test";
import { MSG } from "@taskflow/shared";
import { ScreenBuffer, ATTR_BOLD } from "../render/cells";
import { SessionTerminal } from "./session-terminal";
import { blitTerminal } from "./blit";
import type { NetLike } from "../net/client";

function stubNet(): NetLike {
    return {
        request<T>(type: string): Promise<T> {
            if (type === MSG.SESSION_SNAPSHOT) {
                return Promise.resolve({
                    snapshot: null,
                    lastSequence: 0,
                    cursorHidden: false,
                } as unknown as T);
            }
            return Promise.resolve({} as T);
        },
        on: () => () => undefined,
        onStatusChange: () => () => undefined,
    };
}

async function terminalWith(data: string, cols = 20, rows = 5): Promise<SessionTerminal> {
    const term = new SessionTerminal({
        net: stubNet(),
        sessionId: "s1",
        owner: {},
        cols,
        rows,
    });
    await new Promise<void>((resolve) => term.terminal.write(data, resolve));
    return term;
}

describe("blitTerminal", () => {
    test("copies characters at the given offset", async () => {
        const term = await terminalWith("hi");
        const buf = new ScreenBuffer(20, 5);
        blitTerminal(term, buf, 3, 1, 20, 5);
        expect(buf.get(3, 1).ch).toBe("h");
        expect(buf.get(4, 1).ch).toBe("i");
        term.dispose();
    });

    test("preserves a palette color as a palette index, never rgb", async () => {
        const term = await terminalWith("\x1b[31mR");
        const buf = new ScreenBuffer(20, 5);
        blitTerminal(term, buf, 0, 0, 20, 5);
        expect(buf.get(0, 0).fg).toEqual({ kind: "palette", index: 1 });
        term.dispose();
    });

    test("carries a truecolor foreground through as rgb", async () => {
        const term = await terminalWith("\x1b[38;2;10;20;30mX");
        const buf = new ScreenBuffer(20, 5);
        blitTerminal(term, buf, 0, 0, 20, 5);
        expect(buf.get(0, 0).fg).toEqual({ kind: "rgb", r: 10, g: 20, b: 30 });
        term.dispose();
    });

    test("leaves an unstyled cell on the default color", async () => {
        const term = await terminalWith("p");
        const buf = new ScreenBuffer(20, 5);
        blitTerminal(term, buf, 0, 0, 20, 5);
        expect(buf.get(0, 0).fg).toEqual({ kind: "default" });
        term.dispose();
    });

    test("carries bold through as an attribute", async () => {
        const term = await terminalWith("\x1b[1mB");
        const buf = new ScreenBuffer(20, 5);
        blitTerminal(term, buf, 0, 0, 20, 5);
        expect(buf.get(0, 0).attrs & ATTR_BOLD).toBe(ATTR_BOLD);
        term.dispose();
    });

    test("marks the continuation cell of a wide glyph with width zero", async () => {
        const term = await terminalWith("你");
        const buf = new ScreenBuffer(20, 5);
        blitTerminal(term, buf, 0, 0, 20, 5);
        expect(buf.get(0, 0).width).toBe(2);
        expect(buf.get(1, 0).width).toBe(0);
        term.dispose();
    });

    test("returns the cursor in screen coordinates", async () => {
        const term = await terminalWith("abc");
        const buf = new ScreenBuffer(20, 5);
        const cursor = blitTerminal(term, buf, 2, 1, 20, 5);
        expect(cursor).toEqual({ x: 5, y: 1 });
        term.dispose();
    });

    test("returns null when the cursor sits past the last column", async () => {
        // IBuffer.cursorX may equal cols ("after last cell of the row"), which
        // is outside the rect and would bleed into the neighbouring pane.
        const term = await terminalWith("abcde", 5, 2);
        const buf = new ScreenBuffer(10, 4);
        expect(blitTerminal(term, buf, 0, 0, 5, 2)).toBeNull();
        term.dispose();
    });

    test("returns null for a hidden cursor", async () => {
        const term = await terminalWith("\x1b[?25labc");
        const buf = new ScreenBuffer(20, 5);
        expect(blitTerminal(term, buf, 0, 0, 20, 5)).toBeNull();
        term.dispose();
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/tui/src/term/blit.test.ts`
Expected: FAIL — cannot resolve `./blit`.

- [ ] **Step 3: Write the implementation**

`packages/tui/src/term/blit.ts`:

```ts
import type { IBufferCell } from "@xterm/headless";
import {
    ScreenBuffer,
    DEFAULT_COLOR,
    ATTR_BOLD,
    ATTR_DIM,
    ATTR_ITALIC,
    ATTR_UNDERLINE,
    ATTR_INVERSE,
    ATTR_STRIKE,
    type Cell,
    type Color,
} from "../render/cells";
import type { SessionTerminal } from "./session-terminal";

function foreground(cell: IBufferCell): Color {
    if (cell.isFgDefault()) return DEFAULT_COLOR;
    if (cell.isFgPalette()) return { kind: "palette", index: cell.getFgColor() };
    const packed = cell.getFgColor();
    return { kind: "rgb", r: (packed >> 16) & 0xff, g: (packed >> 8) & 0xff, b: packed & 0xff };
}

function background(cell: IBufferCell): Color {
    if (cell.isBgDefault()) return DEFAULT_COLOR;
    if (cell.isBgPalette()) return { kind: "palette", index: cell.getBgColor() };
    const packed = cell.getBgColor();
    return { kind: "rgb", r: (packed >> 16) & 0xff, g: (packed >> 8) & 0xff, b: packed & 0xff };
}

function attributes(cell: IBufferCell): number {
    return (
        (cell.isBold() ? ATTR_BOLD : 0) |
        (cell.isDim() ? ATTR_DIM : 0) |
        (cell.isItalic() ? ATTR_ITALIC : 0) |
        (cell.isUnderline() ? ATTR_UNDERLINE : 0) |
        (cell.isInverse() ? ATTR_INVERSE : 0) |
        (cell.isStrikethrough() ? ATTR_STRIKE : 0)
    );
}

function toCell(cell: IBufferCell): Cell {
    const width = cell.getWidth();
    const chars = cell.getChars();
    return {
        ch: width === 0 ? "" : chars === "" ? " " : chars,
        width: width === 0 ? 0 : width === 2 ? 2 : 1,
        fg: foreground(cell),
        bg: background(cell),
        attrs: attributes(cell),
    };
}

/**
 * Copy the visible viewport of a session's terminal into `buf` at (x0, y0).
 * Returns the cursor position in screen coordinates, or null when hidden.
 */
function blitTerminal(
    source: SessionTerminal,
    buf: ScreenBuffer,
    x0: number,
    y0: number,
    cols: number,
    rows: number,
): { x: number; y: number } | null {
    const active = source.terminal.buffer.active;

    for (let row = 0; row < rows; row++) {
        const line = active.getLine(active.viewportY + row);
        for (let col = 0; col < cols; col++) {
            const cell = line?.getCell(col);
            buf.set(
                x0 + col,
                y0 + row,
                cell === undefined
                    ? { ch: " ", width: 1, fg: DEFAULT_COLOR, bg: DEFAULT_COLOR, attrs: 0 }
                    : toCell(cell),
            );
        }
    }

    if (source.cursorHidden) return null;
    // cursorX may equal cols ("after last cell of the row"), which is outside
    // the rect; parking the real cursor there would bleed into the next pane.
    if (active.cursorX >= cols || active.cursorY >= rows) return null;
    return { x: x0 + active.cursorX, y: y0 + active.cursorY };
}

export { blitTerminal };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test packages/tui/src/term/blit.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/tui/src/term
git commit -m "feat(tui): blit terminal buffers into the screen"
```

---

### Task 11: State store

**Files:**
- Create: `packages/tui/src/state/store.ts`
- Test: `packages/tui/src/state/store.test.ts`

**Interfaces:**
- Consumes: `NetLike` (Task 1); `Project`, `Task` from `@taskflow/shared`.
- Produces: `class Store` with `constructor(net: NetLike)`, `load(): Promise<void>`, `get projects(): readonly Project[]`, `get tasks(): readonly Task[]`, `tasksFor(projectId: string): Task[]`, `onChange(listener: () => void): () => void`, `dispose(): void`.

The store mirrors backend records and re-emits one change signal. It holds no rendering state; the UI reads from it.

- [ ] **Step 1: Write the failing test**

`packages/tui/src/state/store.test.ts`:

```ts
import { describe, test, expect } from "bun:test";
import { MSG } from "@taskflow/shared";
import type { Project, Task } from "@taskflow/shared";
import { Store } from "./store";
import type { NetLike } from "../net/client";

function project(id: string, name: string): Project {
    return { id, name, path: `/tmp/${id}`, sessions: [], attributes: [], createdAt: "" };
}

function task(id: string, projectId: string, title: string): Task {
    return {
        id,
        projectId,
        title,
        description: "",
        notes: "",
        worktree: { enabled: false, path: null, branch: null, pr: null },
        sessions: [],
        attributes: [],
        createdAt: "",
        status: "active",
        archivedAt: null,
        pinned: false,
    };
}

interface FakeNet extends NetLike {
    emit(type: string, payload: unknown): void;
}

function fakeNet(projects: Project[], tasks: Task[]): FakeNet {
    const listeners = new Map<string, Set<(payload: unknown) => void>>();
    return {
        request<T>(type: string): Promise<T> {
            if (type === MSG.PROJECT_LIST) return Promise.resolve({ projects } as T);
            if (type === MSG.TASK_LIST) return Promise.resolve({ tasks } as T);
            return Promise.reject(new Error(`no stub for ${type}`));
        },
        onStatusChange: () => () => undefined,
        on(type, handler) {
            let set = listeners.get(type);
            if (!set) {
                set = new Set();
                listeners.set(type, set);
            }
            set.add(handler);
            return () => {
                set.delete(handler);
            };
        },
        emit(type, payload) {
            for (const handler of listeners.get(type) ?? []) handler(payload);
        },
    };
}

describe("Store", () => {
    test("loads projects and tasks", async () => {
        const store = new Store(fakeNet([project("p1", "One")], [task("t1", "p1", "Task")]));
        await store.load();
        expect(store.projects).toHaveLength(1);
        expect(store.tasksFor("p1").map((t) => t.id)).toEqual(["t1"]);
        store.dispose();
    });

    test("applies a task update in place and notifies listeners", async () => {
        const net = fakeNet([project("p1", "One")], [task("t1", "p1", "Old")]);
        const store = new Store(net);
        await store.load();
        let notified = 0;
        store.onChange(() => notified++);
        net.emit(MSG.TASK_UPDATED, task("t1", "p1", "New"));
        expect(store.tasksFor("p1")[0]?.title).toBe("New");
        expect(notified).toBe(1);
        store.dispose();
    });

    test("appends a created task", async () => {
        const net = fakeNet([project("p1", "One")], []);
        const store = new Store(net);
        await store.load();
        net.emit(MSG.TASK_CREATED, task("t2", "p1", "Fresh"));
        expect(store.tasksFor("p1")).toHaveLength(1);
        store.dispose();
    });

    test("excludes archived tasks from tasksFor", async () => {
        const archived = { ...task("t3", "p1", "Gone"), status: "archived" as const };
        const store = new Store(fakeNet([project("p1", "One")], [archived]));
        await store.load();
        expect(store.tasksFor("p1")).toHaveLength(0);
        store.dispose();
    });

    test("stops notifying after unsubscribe", async () => {
        const net = fakeNet([project("p1", "One")], []);
        const store = new Store(net);
        await store.load();
        let notified = 0;
        const off = store.onChange(() => notified++);
        off();
        net.emit(MSG.TASK_CREATED, task("t4", "p1", "X"));
        expect(notified).toBe(0);
        store.dispose();
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/tui/src/state/store.test.ts`
Expected: FAIL — cannot resolve `./store`.

- [ ] **Step 3: Write the implementation**

`packages/tui/src/state/store.ts`:

```ts
import { MSG } from "@taskflow/shared";
import type { Project, Task, ProjectListResponse, TaskListResponse } from "@taskflow/shared";
import type { NetLike } from "../net/client";

function upsert<T extends { id: string }>(items: T[], next: T): T[] {
    const index = items.findIndex((item) => item.id === next.id);
    if (index === -1) return [...items, next];
    const copy = [...items];
    copy[index] = next;
    return copy;
}

class Store {
    private projectList: Project[] = [];
    private taskList: Task[] = [];
    private readonly listeners = new Set<() => void>();
    private readonly disposers: Array<() => void> = [];

    constructor(private readonly net: NetLike) {
        this.disposers.push(
            net.on(MSG.PROJECT_CREATED, (payload) => this.applyProject(payload)),
            net.on(MSG.PROJECT_UPDATED, (payload) => this.applyProject(payload)),
            net.on(MSG.PROJECT_REMOVED, (payload) => {
                const { id } = payload as { id: string };
                this.projectList = this.projectList.filter((p) => p.id !== id);
                this.notify();
            }),
            net.on(MSG.TASK_CREATED, (payload) => this.applyTask(payload)),
            net.on(MSG.TASK_UPDATED, (payload) => this.applyTask(payload)),
        );
    }

    private applyProject(payload: unknown): void {
        this.projectList = upsert(this.projectList, payload as Project);
        this.notify();
    }

    private applyTask(payload: unknown): void {
        this.taskList = upsert(this.taskList, payload as Task);
        this.notify();
    }

    private notify(): void {
        for (const listener of this.listeners) listener();
    }

    async load(): Promise<void> {
        const [projects, tasks] = await Promise.all([
            this.net.request<ProjectListResponse>(MSG.PROJECT_LIST),
            this.net.request<TaskListResponse>(MSG.TASK_LIST),
        ]);
        this.projectList = projects.projects;
        this.taskList = tasks.tasks;
        this.notify();
    }

    get projects(): readonly Project[] {
        return this.projectList.filter((p) => p.hidden !== true);
    }

    get tasks(): readonly Task[] {
        return this.taskList;
    }

    tasksFor(projectId: string): Task[] {
        return this.taskList.filter((t) => t.projectId === projectId && t.status === "active");
    }

    onChange(listener: () => void): () => void {
        this.listeners.add(listener);
        return () => {
            this.listeners.delete(listener);
        };
    }

    dispose(): void {
        for (const dispose of this.disposers) dispose();
        this.disposers.length = 0;
        this.listeners.clear();
    }
}

export { Store };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test packages/tui/src/state/store.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/tui/src/state
git commit -m "feat(tui): mirror project and task state from the backend"
```

---

### Task 12: Focus and key routing

**Files:**
- Create: `packages/tui/src/ui/routing.ts`
- Test: `packages/tui/src/ui/routing.test.ts`

**Interfaces:**
- Consumes: `KeyEvent` (Task 6).
- Produces: `type Focus = "sidebar" | "session"`, `type Action` (the union below), and `function route(focus: Focus, ev: KeyEvent, kittyAvailable: boolean, pendingEscape: boolean): { action: Action; pendingEscape: boolean }`.

```ts
type Action =
    | { kind: "none" }
    | { kind: "toggle-focus" }
    | { kind: "move"; delta: -1 | 1 }
    | { kind: "open" }
    | { kind: "select-tab"; index: number }
    | { kind: "zoom" }
    | { kind: "new-task" }
    | { kind: "new-session" }
    | { kind: "close-pane" }
    | { kind: "quit" }
    | { kind: "help" }
    | { kind: "to-child"; ev: KeyEvent };
```

This is the whole keymap as a pure function, which is why it is tested rather than inspected. `pendingEscape` carries the first half of a double-`Esc` in legacy mode; it is always `false` when the kitty protocol is available.

- [ ] **Step 1: Write the failing test**

`packages/tui/src/ui/routing.test.ts`:

```ts
import { describe, test, expect } from "bun:test";
import { route } from "./routing";
import { noMods, type KeyEvent } from "../input/keys";

function key(patch: Partial<KeyEvent>): KeyEvent {
    return { name: "char", mods: noMods(), kind: "press", ...patch };
}

const ctrlEsc = key({ name: "escape", mods: { ...noMods(), ctrl: true } });

describe("route with the kitty protocol available", () => {
    test("ctrl+escape toggles focus from the session", () => {
        expect(route("session", ctrlEsc, true, false).action).toEqual({ kind: "toggle-focus" });
    });

    test("ctrl+escape toggles focus from the sidebar", () => {
        expect(route("sidebar", ctrlEsc, true, false).action).toEqual({ kind: "toggle-focus" });
    });

    test("every other key reaches the child when the session has focus", () => {
        const ev = key({ name: "char", char: "j" });
        expect(route("session", ev, true, false).action).toEqual({
            kind: "to-child",
            events: [ev],
        });
    });

    test("a plain escape reaches the child, not the switcher", () => {
        const ev = key({ name: "escape" });
        expect(route("session", ev, true, false).action).toEqual({
            kind: "to-child",
            events: [ev],
        });
    });

    test("sidebar keys map to commands", () => {
        expect(route("sidebar", key({ char: "j" }), true, false).action).toEqual({
            kind: "move",
            delta: 1,
        });
        expect(route("sidebar", key({ char: "k" }), true, false).action).toEqual({
            kind: "move",
            delta: -1,
        });
        expect(route("sidebar", key({ name: "enter" }), true, false).action).toEqual({
            kind: "open",
        });
        expect(route("sidebar", key({ char: "z" }), true, false).action).toEqual({ kind: "zoom" });
        expect(route("sidebar", key({ char: "n" }), true, false).action).toEqual({
            kind: "new-task",
        });
        expect(route("sidebar", key({ char: "s" }), true, false).action).toEqual({
            kind: "new-session",
        });
        expect(route("sidebar", key({ char: "?" }), true, false).action).toEqual({ kind: "help" });
        expect(route("sidebar", key({ char: "Q" }), true, false).action).toEqual({ kind: "quit" });
    });

    test("number keys select a session tab", () => {
        expect(route("sidebar", key({ char: "3" }), true, false).action).toEqual({
            kind: "select-tab",
            index: 2,
        });
    });

    test("an unbound sidebar key does nothing", () => {
        expect(route("sidebar", key({ char: "@" }), true, false).action).toEqual({ kind: "none" });
    });
});

describe("route in legacy mode", () => {
    test("a first escape is held rather than acted on", () => {
        const result = route("session", key({ name: "escape" }), false, false);
        expect(result.action).toEqual({ kind: "none" });
        expect(result.pendingEscape).toBe(true);
    });

    test("a second escape toggles focus", () => {
        const result = route("session", key({ name: "escape" }), false, true);
        expect(result.action).toEqual({ kind: "toggle-focus" });
        expect(result.pendingEscape).toBe(false);
    });

    test("a non-escape key after a held escape sends both to the child, in order", () => {
        const ev = key({ char: "a" });
        const result = route("session", ev, false, true);
        expect(result.action).toEqual({
            kind: "to-child",
            events: [key({ name: "escape" }), ev],
        });
        expect(result.pendingEscape).toBe(false);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/tui/src/ui/routing.test.ts`
Expected: FAIL — cannot resolve `./routing`.

- [ ] **Step 3: Write the implementation**

`packages/tui/src/ui/routing.ts`:

```ts
import { noMods, type KeyEvent } from "../input/keys";

type Focus = "sidebar" | "session";

type Action =
    | { kind: "none" }
    | { kind: "toggle-focus" }
    | { kind: "move"; delta: -1 | 1 }
    | { kind: "open" }
    | { kind: "select-tab"; index: number }
    | { kind: "zoom" }
    | { kind: "new-task" }
    | { kind: "new-session" }
    | { kind: "close-pane" }
    | { kind: "quit" }
    | { kind: "help" }
    | { kind: "to-child"; events: KeyEvent[] };

interface RouteResult {
    action: Action;
    pendingEscape: boolean;
}

const SIDEBAR_CHARS: Record<string, Action> = {
    j: { kind: "move", delta: 1 },
    k: { kind: "move", delta: -1 },
    z: { kind: "zoom" },
    n: { kind: "new-task" },
    s: { kind: "new-session" },
    q: { kind: "close-pane" },
    Q: { kind: "quit" },
    "?": { kind: "help" },
};

function isSwitcher(ev: KeyEvent): boolean {
    return ev.name === "escape" && ev.mods.ctrl;
}

/**
 * The complete keymap. `pendingEscape` holds the first half of a double-Esc
 * in legacy mode and is always false when the kitty protocol is available.
 */
function route(
    focus: Focus,
    ev: KeyEvent,
    kittyAvailable: boolean,
    pendingEscape: boolean,
): RouteResult {
    if (ev.kind === "release") return { action: { kind: "none" }, pendingEscape };

    if (kittyAvailable) {
        if (isSwitcher(ev)) return { action: { kind: "toggle-focus" }, pendingEscape: false };
    } else if (ev.name === "escape" && !ev.mods.ctrl && !ev.mods.alt) {
        if (pendingEscape) return { action: { kind: "toggle-focus" }, pendingEscape: false };
        return { action: { kind: "none" }, pendingEscape: true };
    }

    if (focus === "session") {
        // A held Escape that turned out not to be a double-Esc still belongs to
        // the child, and must arrive before the key that followed it.
        const events = pendingEscape
            ? [{ name: "escape" as const, mods: noMods(), kind: "press" as const }, ev]
            : [ev];
        return { action: { kind: "to-child", events }, pendingEscape: false };
    }

    if (ev.name === "enter") return { action: { kind: "open" }, pendingEscape: false };

    const char = ev.char;
    if (char !== undefined && !ev.mods.ctrl && !ev.mods.alt) {
        if (char >= "1" && char <= "9") {
            return {
                action: { kind: "select-tab", index: Number.parseInt(char, 10) - 1 },
                pendingEscape: false,
            };
        }
        const mapped = SIDEBAR_CHARS[char];
        if (mapped) return { action: mapped, pendingEscape: false };
    }

    return { action: { kind: "none" }, pendingEscape: false };
}

export { route };
export type { Action, Focus };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test packages/tui/src/ui/routing.test.ts`
Expected: PASS, 12 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/tui/src/ui
git commit -m "feat(tui): add focus and key routing"
```

---

### Task 13: Sidebar rendering

**Files:**
- Create: `packages/tui/src/ui/sidebar.ts`
- Test: `packages/tui/src/ui/sidebar.test.ts`

**Interfaces:**
- Consumes: `ScreenBuffer`, `blankCell`, `ATTR_INVERSE`, `ATTR_BOLD` (Task 3); `Store` (Task 11).
- Produces: `interface SidebarRow { kind: "project" | "task"; id: string; label: string; sessionCount: number }`, `function buildRows(store: Store): SidebarRow[]`, `function drawSidebar(buf: ScreenBuffer, rows: SidebarRow[], selected: number, width: number, height: number): void`.

Splitting row construction from drawing keeps the tree logic testable without a buffer.

- [ ] **Step 1: Write the failing test**

`packages/tui/src/ui/sidebar.test.ts`:

```ts
import { describe, test, expect } from "bun:test";
import { MSG } from "@taskflow/shared";
import type { Project, Task } from "@taskflow/shared";
import { ScreenBuffer, ATTR_INVERSE } from "../render/cells";
import { Store } from "../state/store";
import { buildRows, drawSidebar } from "./sidebar";
import type { NetLike } from "../net/client";

function project(id: string, name: string): Project {
    return { id, name, path: `/tmp/${id}`, sessions: [], attributes: [], createdAt: "" };
}

function task(id: string, projectId: string, title: string, sessions = 0): Task {
    return {
        id,
        projectId,
        title,
        description: "",
        notes: "",
        worktree: { enabled: false, path: null, branch: null, pr: null },
        sessions: Array.from({ length: sessions }, (_, i) => ({
            id: `${id}-s${String(i)}`,
            type: "claude" as const,
            label: "claude",
            createdAt: "",
        })),
        attributes: [],
        createdAt: "",
        status: "active",
        archivedAt: null,
        pinned: false,
    };
}

function stubNet(projects: Project[], tasks: Task[]): NetLike {
    return {
        request<T>(type: string): Promise<T> {
            if (type === MSG.PROJECT_LIST) return Promise.resolve({ projects } as T);
            if (type === MSG.TASK_LIST) return Promise.resolve({ tasks } as T);
            return Promise.reject(new Error(`no stub for ${type}`));
        },
        on: () => () => undefined,
        onStatusChange: () => () => undefined,
    };
}

function rowText(buf: ScreenBuffer, y: number, width: number): string {
    let out = "";
    for (let x = 0; x < width; x++) out += buf.get(x, y).ch;
    return out.trimEnd();
}

describe("buildRows", () => {
    test("lists each project followed by its active tasks", async () => {
        const store = new Store(
            stubNet(
                [project("p1", "Alpha"), project("p2", "Beta")],
                [task("t1", "p1", "First"), task("t2", "p2", "Second")],
            ),
        );
        await store.load();
        expect(buildRows(store).map((r) => `${r.kind}:${r.label}`)).toEqual([
            "project:Alpha",
            "task:First",
            "project:Beta",
            "task:Second",
        ]);
        store.dispose();
    });

    test("carries the session count on task rows", async () => {
        const store = new Store(stubNet([project("p1", "Alpha")], [task("t1", "p1", "First", 2)]));
        await store.load();
        expect(buildRows(store)[1]?.sessionCount).toBe(2);
        store.dispose();
    });
});

describe("drawSidebar", () => {
    test("draws project and task labels", () => {
        const buf = new ScreenBuffer(20, 5);
        drawSidebar(
            buf,
            [
                { kind: "project", id: "p1", label: "Alpha", sessionCount: 0 },
                { kind: "task", id: "t1", label: "First", sessionCount: 0 },
            ],
            0,
            20,
            5,
        );
        expect(rowText(buf, 0, 20)).toContain("Alpha");
        expect(rowText(buf, 1, 20)).toContain("First");
    });

    test("marks the selected row with the inverse attribute", () => {
        const buf = new ScreenBuffer(20, 5);
        drawSidebar(
            buf,
            [
                { kind: "project", id: "p1", label: "Alpha", sessionCount: 0 },
                { kind: "task", id: "t1", label: "First", sessionCount: 0 },
            ],
            1,
            20,
            5,
        );
        expect(buf.get(0, 1).attrs & ATTR_INVERSE).toBe(ATTR_INVERSE);
        expect(buf.get(0, 0).attrs & ATTR_INVERSE).toBe(0);
    });

    test("truncates a label that exceeds the width", () => {
        const buf = new ScreenBuffer(10, 2);
        drawSidebar(
            buf,
            [{ kind: "task", id: "t1", label: "AnExtremelyLongTaskTitle", sessionCount: 0 }],
            0,
            10,
            2,
        );
        expect(rowText(buf, 0, 10).length).toBeLessThanOrEqual(10);
    });

    test("shows a session count badge when a task has sessions", () => {
        const buf = new ScreenBuffer(20, 2);
        drawSidebar(buf, [{ kind: "task", id: "t1", label: "First", sessionCount: 3 }], 0, 20, 2);
        expect(rowText(buf, 0, 20)).toContain("3");
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/tui/src/ui/sidebar.test.ts`
Expected: FAIL — cannot resolve `./sidebar`.

- [ ] **Step 3: Write the implementation**

`packages/tui/src/ui/sidebar.ts`:

```ts
import { ScreenBuffer, blankCell, ATTR_BOLD, ATTR_INVERSE, type Cell } from "../render/cells";
import type { Store } from "../state/store";

interface SidebarRow {
    kind: "project" | "task";
    id: string;
    label: string;
    sessionCount: number;
}

function buildRows(store: Store): SidebarRow[] {
    const rows: SidebarRow[] = [];
    for (const project of store.projects) {
        rows.push({
            kind: "project",
            id: project.id,
            label: project.name,
            sessionCount: project.sessions.length,
        });
        for (const task of store.tasksFor(project.id)) {
            rows.push({
                kind: "task",
                id: task.id,
                label: task.title,
                sessionCount: task.sessions.length,
            });
        }
    }
    return rows;
}

function styled(ch: string, attrs: number): Cell {
    return { ...blankCell(), ch, attrs };
}

function drawSidebar(
    buf: ScreenBuffer,
    rows: SidebarRow[],
    selected: number,
    width: number,
    height: number,
): void {
    for (let y = 0; y < height; y++) {
        const row = rows[y];
        const attrs =
            (y === selected ? ATTR_INVERSE : 0) | (row?.kind === "project" ? ATTR_BOLD : 0);

        const badge = row && row.sessionCount > 0 ? ` ${String(row.sessionCount)}` : "";
        const prefix = row === undefined ? "" : row.kind === "project" ? "" : "  ";
        const available = Math.max(0, width - prefix.length - badge.length);
        const label = (row?.label ?? "").slice(0, available);
        const text = row === undefined ? "" : `${prefix}${label}${badge}`;

        for (let x = 0; x < width; x++) {
            buf.set(x, y, styled(text[x] ?? " ", attrs));
        }
    }
}

export { buildRows, drawSidebar };
export type { SidebarRow };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test packages/tui/src/ui/sidebar.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/tui/src/ui
git commit -m "feat(tui): render the project and task sidebar"
```

---

### Task 14: Session pane and tab strip

**Files:**
- Create: `packages/tui/src/ui/session-pane.ts`
- Test: `packages/tui/src/ui/session-pane.test.ts`

**Interfaces:**
- Consumes: `ScreenBuffer`, `blankCell`, `ATTR_INVERSE` (Task 3); `SessionTerminal` (Task 9); `blitTerminal` (Task 10).
- Produces: `interface TabSpec { label: string; active: boolean }`, `function drawTabs(buf: ScreenBuffer, x0: number, y0: number, width: number, tabs: TabSpec[]): void`, `function drawSessionPane(buf: ScreenBuffer, session: SessionTerminal | null, rect: { x: number; y: number; width: number; height: number }): { x: number; y: number } | null`.

- [ ] **Step 1: Write the failing test**

`packages/tui/src/ui/session-pane.test.ts`:

```ts
import { describe, test, expect } from "bun:test";
import { MSG } from "@taskflow/shared";
import { ScreenBuffer, ATTR_INVERSE } from "../render/cells";
import { SessionTerminal } from "../term/session-terminal";
import { drawTabs, drawSessionPane } from "./session-pane";
import type { NetLike } from "../net/client";

function stubNet(): NetLike {
    return {
        request<T>(type: string): Promise<T> {
            if (type === MSG.SESSION_SNAPSHOT) {
                return Promise.resolve({
                    snapshot: null,
                    lastSequence: 0,
                    cursorHidden: false,
                } as unknown as T);
            }
            return Promise.resolve({} as T);
        },
        on: () => () => undefined,
        onStatusChange: () => () => undefined,
    };
}

function rowText(buf: ScreenBuffer, y: number, width: number): string {
    let out = "";
    for (let x = 0; x < width; x++) out += buf.get(x, y).ch;
    return out.trimEnd();
}

describe("drawTabs", () => {
    test("renders every tab label", () => {
        const buf = new ScreenBuffer(30, 2);
        drawTabs(buf, 0, 0, 30, [
            { label: "claude", active: true },
            { label: "shell", active: false },
        ]);
        const text = rowText(buf, 0, 30);
        expect(text).toContain("claude");
        expect(text).toContain("shell");
    });

    test("marks the active tab with the inverse attribute", () => {
        const buf = new ScreenBuffer(30, 2);
        drawTabs(buf, 0, 0, 30, [{ label: "claude", active: true }]);
        expect(buf.get(1, 0).attrs & ATTR_INVERSE).toBe(ATTR_INVERSE);
    });
});

describe("drawSessionPane", () => {
    test("blits session content into the rect and returns the cursor", async () => {
        const session = new SessionTerminal({
            net: stubNet(),
            sessionId: "s1",
            owner: {},
            cols: 10,
            rows: 3,
        });
        await new Promise<void>((resolve) => session.terminal.write("hey", resolve));

        const buf = new ScreenBuffer(20, 6);
        const cursor = drawSessionPane(buf, session, { x: 5, y: 2, width: 10, height: 3 });
        expect(buf.get(5, 2).ch).toBe("h");
        expect(cursor).toEqual({ x: 8, y: 2 });
        session.dispose();
    });

    test("clears the rect and returns null when there is no session", () => {
        const buf = new ScreenBuffer(20, 6);
        buf.set(5, 2, { ...buf.get(5, 2), ch: "X" });
        const cursor = drawSessionPane(buf, null, { x: 5, y: 2, width: 10, height: 3 });
        expect(buf.get(5, 2).ch).toBe(" ");
        expect(cursor).toBeNull();
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/tui/src/ui/session-pane.test.ts`
Expected: FAIL — cannot resolve `./session-pane`.

- [ ] **Step 3: Write the implementation**

`packages/tui/src/ui/session-pane.ts`:

```ts
import { ScreenBuffer, blankCell, ATTR_INVERSE, type Cell } from "../render/cells";
import { blitTerminal } from "../term/blit";
import type { SessionTerminal } from "../term/session-terminal";

interface TabSpec {
    label: string;
    active: boolean;
}

interface Rect {
    x: number;
    y: number;
    width: number;
    height: number;
}

function styled(ch: string, attrs: number): Cell {
    return { ...blankCell(), ch, attrs };
}

function drawTabs(
    buf: ScreenBuffer,
    x0: number,
    y0: number,
    width: number,
    tabs: TabSpec[],
): void {
    for (let x = 0; x < width; x++) buf.set(x0 + x, y0, blankCell());

    let cursor = 0;
    for (const tab of tabs) {
        const text = ` ${tab.label} `;
        const attrs = tab.active ? ATTR_INVERSE : 0;
        for (const ch of text) {
            if (cursor >= width) return;
            buf.set(x0 + cursor, y0, styled(ch, attrs));
            cursor++;
        }
    }
}

function drawSessionPane(
    buf: ScreenBuffer,
    session: SessionTerminal | null,
    rect: Rect,
): { x: number; y: number } | null {
    if (session === null) {
        for (let y = 0; y < rect.height; y++) {
            for (let x = 0; x < rect.width; x++) buf.set(rect.x + x, rect.y + y, blankCell());
        }
        return null;
    }
    return blitTerminal(session, buf, rect.x, rect.y, rect.width, rect.height);
}

export { drawTabs, drawSessionPane };
export type { TabSpec };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test packages/tui/src/ui/session-pane.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/tui/src/ui
git commit -m "feat(tui): render the session pane and tab strip"
```

---

### Task 15: Application shell and entry point

**Files:**
- Create: `packages/tui/src/ui/app.ts`
- Create: `packages/tui/src/index.ts`
- Test: `packages/tui/src/ui/app.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 1-14.
- Produces: `class App` with `constructor(deps: { net: NetLike; store: Store; screen: Screen; cols: number; rows: number; kittyAvailable: boolean })`, `init(): Promise<void>`, `handleKey(ev: KeyEvent): void`, `render(): void`, `get focus(): Focus`, `get running(): boolean`.

`App` takes its dependencies rather than constructing them, so the test drives it with a fake net and a collecting sink — no terminal involved.

- [ ] **Step 1: Write the failing test**

`packages/tui/src/ui/app.test.ts`:

```ts
import { describe, test, expect } from "bun:test";
import { MSG } from "@taskflow/shared";
import type { Project, Task } from "@taskflow/shared";
import { Screen, type Sink } from "../render/screen";
import { Store } from "../state/store";
import { App } from "./app";
import { noMods, type KeyEvent } from "../input/keys";
import type { NetLike } from "../net/client";

function project(id: string, name: string): Project {
    return { id, name, path: `/tmp/${id}`, sessions: [], attributes: [], createdAt: "" };
}

function task(id: string, projectId: string, title: string): Task {
    return {
        id,
        projectId,
        title,
        description: "",
        notes: "",
        worktree: { enabled: false, path: null, branch: null, pr: null },
        sessions: [],
        attributes: [],
        createdAt: "",
        status: "active",
        archivedAt: null,
        pinned: false,
    };
}

function stubNet(): NetLike {
    return {
        request<T>(type: string): Promise<T> {
            if (type === MSG.PROJECT_LIST) {
                return Promise.resolve({ projects: [project("p1", "Alpha")] } as T);
            }
            if (type === MSG.TASK_LIST) {
                return Promise.resolve({ tasks: [task("t1", "p1", "Build the TUI")] } as T);
            }
            return Promise.resolve({} as T);
        },
        on: () => () => undefined,
        onStatusChange: () => () => undefined,
    };
}

function collectingSink(): Sink & { output: string } {
    return {
        output: "",
        write(data: string) {
            this.output += data;
        },
    };
}

function key(patch: Partial<KeyEvent>): KeyEvent {
    return { name: "char", mods: noMods(), kind: "press", ...patch };
}

async function makeApp(): Promise<{ app: App; sink: Sink & { output: string } }> {
    const net = stubNet();
    const store = new Store(net);
    const sink = collectingSink();
    const app = new App({
        net,
        store,
        screen: new Screen(sink, 60, 10),
        cols: 60,
        rows: 10,
        kittyAvailable: true,
    });
    await app.init();
    return { app, sink };
}

describe("App", () => {
    test("renders project and task names on the first frame", async () => {
        const { app, sink } = await makeApp();
        app.render();
        expect(sink.output).toContain("Alpha");
        expect(sink.output).toContain("Build the TUI");
    });

    test("starts with the sidebar focused", async () => {
        const { app } = await makeApp();
        expect(app.focus).toBe("sidebar");
    });

    test("ctrl+escape toggles focus", async () => {
        const { app } = await makeApp();
        const ctrlEsc = key({ name: "escape", mods: { ...noMods(), ctrl: true } });
        app.handleKey(ctrlEsc);
        expect(app.focus).toBe("session");
        app.handleKey(ctrlEsc);
        expect(app.focus).toBe("sidebar");
    });

    test("j and k move the sidebar selection", async () => {
        const { app, sink } = await makeApp();
        app.render();
        sink.output = "";
        app.handleKey(key({ char: "j" }));
        app.render();
        expect(sink.output).not.toBe("");
    });

    test("Q stops the app", async () => {
        const { app } = await makeApp();
        expect(app.running).toBe(true);
        app.handleKey(key({ char: "Q" }));
        expect(app.running).toBe(false);
    });

    test("a second identical frame writes nothing", async () => {
        const { app, sink } = await makeApp();
        app.render();
        sink.output = "";
        app.render();
        expect(sink.output).toBe("");
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/tui/src/ui/app.test.ts`
Expected: FAIL — cannot resolve `./app`.

- [ ] **Step 3: Write `app.ts`**

```ts
import { MSG } from "@taskflow/shared";
import type { Screen } from "../render/screen";
import type { Store } from "../state/store";
import type { NetLike } from "../net/client";
import type { KeyEvent } from "../input/keys";
import { encodeForChild } from "../input/encode";
import { SessionTerminal } from "../term/session-terminal";
import { buildRows, drawSidebar, type SidebarRow } from "./sidebar";
import { drawTabs, drawSessionPane, type TabSpec } from "./session-pane";
import { route, type Focus } from "./routing";

interface AppDeps {
    net: NetLike;
    store: Store;
    screen: Screen;
    cols: number;
    rows: number;
    kittyAvailable: boolean;
}

const SIDEBAR_WIDTH = 30;

class App {
    private selected = 0;
    private focusTarget: Focus = "sidebar";
    private pendingEscape = false;
    private zoomed = false;
    private alive = true;
    private rows: SidebarRow[] = [];
    private sessions: Array<{ id: string; term: SessionTerminal }> = [];
    private activeSession = 0;

    constructor(private readonly deps: AppDeps) {}

    async init(): Promise<void> {
        await this.deps.store.load();
        this.rows = buildRows(this.deps.store);
    }

    get focus(): Focus {
        return this.focusTarget;
    }

    get running(): boolean {
        return this.alive;
    }

    handleKey(ev: KeyEvent): void {
        const result = route(this.focusTarget, ev, this.deps.kittyAvailable, this.pendingEscape);
        this.pendingEscape = result.pendingEscape;
        const action = result.action;

        switch (action.kind) {
            case "toggle-focus":
                this.focusTarget = this.focusTarget === "sidebar" ? "session" : "sidebar";
                return;
            case "move":
                this.selected = Math.max(
                    0,
                    Math.min(this.rows.length - 1, this.selected + action.delta),
                );
                return;
            case "select-tab":
                if (action.index < this.sessions.length) this.activeSession = action.index;
                return;
            case "zoom":
                this.zoomed = !this.zoomed;
                return;
            case "quit":
                this.alive = false;
                return;
            case "to-child": {
                const session = this.sessions[this.activeSession];
                if (!session) return;
                let data = "";
                for (const ev of action.events) data += encodeForChild(ev, session.term.modes);
                if (data === "") return;
                void this.deps.net
                    .request(MSG.SESSION_INPUT, { sessionId: session.id, data })
                    .catch(() => undefined);
                return;
            }
            default:
                return;
        }
    }

    render(): void {
        const { screen, cols, rows } = this.deps;
        this.rows = buildRows(this.deps.store);

        const sidebarWidth = this.zoomed ? 0 : Math.min(SIDEBAR_WIDTH, Math.floor(cols / 3));
        if (sidebarWidth > 0) {
            drawSidebar(screen.back, this.rows, this.selected, sidebarWidth, rows);
        }

        const paneX = sidebarWidth;
        const paneWidth = cols - sidebarWidth;
        const tabs: TabSpec[] = this.sessions.map((_, i) => ({
            label: `session ${String(i + 1)}`,
            active: i === this.activeSession,
        }));
        drawTabs(screen.back, paneX, 0, paneWidth, tabs);

        const active = this.sessions[this.activeSession];
        const cursor = drawSessionPane(screen.back, active?.term ?? null, {
            x: paneX,
            y: 1,
            width: paneWidth,
            height: rows - 1,
        });

        screen.setCursor(this.focusTarget === "session" ? cursor : null);
        screen.flush();
    }
}

export { App };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test packages/tui/src/ui/app.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Write `index.ts`**

```ts
import { startBackend } from "./backend/manager";
import { WsClient } from "./net/client";
import { Store } from "./state/store";
import { Screen } from "./render/screen";
import { Tty, leaveSequence } from "./term/tty";
import { negotiateKitty } from "./input/negotiate";
import { decodeKitty } from "./input/decode-kitty";
import { decodeLegacy, flushCarry } from "./input/decode-legacy";
import { App } from "./ui/app";

const FRAME_INTERVAL_MS = 16;
/** How long a held ESC waits for a continuation before counting as a real Escape. */
const ESCAPE_IDLE_MS = 25;

function readOnce(timeoutMs: number): Promise<string> {
    return new Promise((resolve) => {
        const timer = setTimeout(() => {
            process.stdin.off("data", onData);
            resolve("");
        }, timeoutMs);
        const onData = (chunk: Buffer): void => {
            clearTimeout(timer);
            process.stdin.off("data", onData);
            resolve(chunk.toString("utf-8"));
        };
        process.stdin.on("data", onData);
    });
}

async function main(): Promise<void> {
    const devBranch = process.env.TASKFLOW_DEV_BRANCH ?? null;
    const binary = process.env.TASKFLOW_BACKEND_BIN ?? "taskflow-backend";
    const backend = await startBackend({ binary, args: [], devBranch });

    const net = new WsClient(backend.port);
    await net.connect();

    const sink = { write: (data: string) => void process.stdout.write(data) };
    // Raw mode is entered before anything that can throw, so the handlers that
    // undo it are installed first. Without this, a failure in negotiation or
    // init leaves the user staring at a dead shell.
    const tty = new Tty(sink, { kitty: false });
    tty.installExitHandlers();
    process.stdin.setRawMode(true);
    process.stdin.resume();

    const kittyAvailable = await negotiateKitty({ write: sink.write, waitForData: readOnce });
    const ttyReal = new Tty(sink, { kitty: kittyAvailable });
    ttyReal.installExitHandlers();
    ttyReal.enter();

    const cols = process.stdout.columns || 80;
    const rows = process.stdout.rows || 24;
    const screen = new Screen(sink, cols, rows);
    const store = new Store(net);
    const app = new App({ net, store, screen, cols, rows, kittyAvailable });
    await app.init();

    let carry = "";
    let carryTimer: ReturnType<typeof setTimeout> | null = null;

    process.stdin.on("data", (chunk: Buffer) => {
        if (carryTimer !== null) {
            clearTimeout(carryTimer);
            carryTimer = null;
        }
        const decode = kittyAvailable ? decodeKitty : decodeLegacy;
        const result = decode(chunk.toString("utf-8"), carry);
        carry = result.carry;
        for (const ev of result.events) app.handleKey(ev);

        // A held ESC is only a real Escape press if nothing follows it.
        if (carry !== "") {
            carryTimer = setTimeout(() => {
                carryTimer = null;
                const stranded = carry;
                carry = "";
                for (const ev of flushCarry(stranded)) app.handleKey(ev);
            }, ESCAPE_IDLE_MS);
        }
    });

    const timer = setInterval(() => {
        if (!app.running) {
            clearInterval(timer);
            ttyReal.leave();
            net.close();
            backend.stop();
            process.exit(0);
        }
        app.render();
    }, FRAME_INTERVAL_MS);
}

void main().catch((err: unknown) => {
    // Restore unconditionally: main() may have thrown before its own handlers
    // were armed, and a half-configured terminal is unusable.
    process.stdout.write(leaveSequence({ kitty: true }));
    if (process.stdin.isTTY) process.stdin.setRawMode(false);
    console.error(err);
    process.exit(1);
});
```

- [ ] **Step 6: Manual smoke test**

The backend must be built first: `bun run build:backend:bin` from the repo root.

Run in a terminal with the kitty keyboard protocol (Ghostty, Kitty, foot, or Alacritty):

```bash
TASKFLOW_BACKEND_BIN=packages/backend/dist/taskflow-backend \
TASKFLOW_DEV_BRANCH=$(git rev-parse --abbrev-ref HEAD | tr / -) \
bun run packages/tui/src/index.ts
```

Verify, in order:
1. The sidebar lists your projects and their active tasks.
2. `j` and `k` move the selection and the highlight follows.
3. `Ctrl+Esc` moves focus to the session pane and back.
4. Pressing `Esc` on its own does not hang or get swallowed, and pressing an arrow key still moves the selection — this is the `flushCarry` idle timer working.
5. `Q` exits, and the terminal is returned to normal — cursor visible, echo working, no leftover alternate screen.
6. `kill -TERM <pid>` from another terminal also restores the terminal cleanly.

Any failure here is a bug in an earlier task, not something to patch in `index.ts`.

- [ ] **Step 7: Run the full check and commit**

```bash
bun run lint && bun run typecheck && bun test
git add packages/tui
git commit -m "feat(tui): wire the application shell and entry point"
```

---

---

### Task 16: Backend — bind to loopback and report connected clients

**Files:**
- Modify: `packages/backend/src/ws/server.ts`
- Modify: `packages/shared/src/constants.ts`
- Modify: `packages/shared/src/types/ws.ts`
- Test: `packages/backend/src/ws/server.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `MSG.SYSTEM_CLIENTS` (`"system:clients"`) and `interface SystemClientsEvent { count: number }` in `@taskflow/shared`.

Two changes to the existing backend, both small. `Bun.serve` defaults to all interfaces, so the backend currently listens on `*:<port>` with no authentication — verifiable with `lsof -nP -iTCP -sTCP:LISTEN | grep taskflow`. Binding to loopback closes that and makes an SSH tunnel the only remote route.

The client count exists so the TUI can explain misrendering when the desktop app is attached to the same session (spec, Remote operation). The server already tracks a `Set` of clients; this only reports its size.

- [ ] **Step 1: Write the failing test**

`packages/backend/src/ws/server.test.ts`:

```ts
import { describe, test, expect, afterEach } from "bun:test";
import { MSG } from "@taskflow/shared";
import { Router } from "./router";
import { createServer } from "./server";

let stop: (() => void) | null = null;

afterEach(() => {
    stop?.();
    stop = null;
});

async function startTestServer(): Promise<number> {
    const router = new Router();
    router.register("ping", () => Promise.resolve({ ok: true }));
    const server = createServer(router, 0);
    const started = await server.start();
    stop = started.stop;
    return started.port;
}

function connect(port: number, host = "127.0.0.1"): Promise<WebSocket> {
    return new Promise((resolve, reject) => {
        const ws = new WebSocket(`ws://${host}:${port}`);
        ws.onopen = () => resolve(ws);
        ws.onerror = () => reject(new Error("connect failed"));
    });
}

describe("createServer", () => {
    test("accepts connections on loopback", async () => {
        const port = await startTestServer();
        const ws = await connect(port);
        expect(ws.readyState).toBe(WebSocket.OPEN);
        ws.close();
    });

    test("broadcasts the connected client count as clients join", async () => {
        const port = await startTestServer();
        const first = await connect(port);

        const counts: number[] = [];
        first.onmessage = (event: MessageEvent) => {
            const parsed = JSON.parse(String(event.data)) as {
                type?: string;
                payload?: { count?: number };
            };
            if (parsed.type === MSG.SYSTEM_CLIENTS && typeof parsed.payload?.count === "number") {
                counts.push(parsed.payload.count);
            }
        };

        const second = await connect(port);
        await Bun.sleep(50);
        expect(counts).toContain(2);

        second.close();
        await Bun.sleep(50);
        expect(counts).toContain(1);
        first.close();
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/backend/src/ws/server.test.ts`
Expected: FAIL — `MSG.SYSTEM_CLIENTS` does not exist.

- [ ] **Step 3: Add the message and its payload type**

In `packages/shared/src/constants.ts`, beside the existing `SYSTEM_INFO` entry:

```ts
    SYSTEM_INFO: "system:info",
    SYSTEM_CLIENTS: "system:clients",
```

In `packages/shared/src/types/ws.ts`, beside the other system types:

```ts
export interface SystemClientsEvent {
    count: number;
}
```

- [ ] **Step 4: Bind to loopback and broadcast the count**

In `packages/backend/src/ws/server.ts`, add the hostname to the `Bun.serve` call:

```ts
        server = Bun.serve({
            port,
            hostname: process.env.TASKFLOW_HOST ?? "127.0.0.1",
            async fetch(req, server) {
```

The existing clients all address the backend by name, not by address — the UI
uses `ws://localhost:${port}` (`useWebSocket.ts:67`) and every spawned agent gets
`TASKFLOW_API_URL: http://localhost:${port}` (`session-lifecycle.ts:454`). The
current socket is an IPv6 wildcard, so this change makes it IPv4-only, which
looks like it could strand a client that resolves `localhost` to `::1`.

It does not, and that was checked rather than assumed: with a server bound to
`127.0.0.1`, a request to `http://localhost:<port>` succeeds, because clients try
both address families. The escape hatch is there for the unusual host that
resolves `localhost` to `::1` only, where `TASKFLOW_HOST=::1` restores service
without reopening the socket to the network.

Then broadcast the count whenever the client set changes. Replace the existing
`open` and `close` handlers with:

```ts
                open(ws) {
                    clients.add(ws);
                    if (connectCallback) connectCallback();
                    broadcastClientCount();
                },
                close(ws) {
                    clients.delete(ws);
                    broadcastClientCount();
                },
```

and add this helper next to `broadcast`:

```ts
    function broadcastClientCount(): void {
        broadcast({ type: MSG.SYSTEM_CLIENTS, payload: { count: clients.size } });
    }
```

`MSG` needs importing in this file if it is not already:

```ts
import { MSG } from "@taskflow/shared";
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `bun test packages/backend/src/ws/server.test.ts`
Expected: PASS, 2 tests.

- [ ] **Step 6: Verify the exposure is actually closed**

Start the backend and confirm it no longer listens on all interfaces:

```bash
lsof -nP -iTCP -sTCP:LISTEN | grep taskflow
```

Expected: an address of the form `127.0.0.1:<port>`. A `*:<port>` result means
the change did not take effect. Before this task that command reports `*:<port>`.

Then confirm the existing clients still work, since they connect by name: launch
the Electron app and check it reaches the backend, and run `taskflow-cli task`
inside an agent session. Both go through `localhost` and must still succeed.

- [ ] **Step 7: Run the full check and commit**

```bash
bun run lint && bun run typecheck && bun test
git add packages/backend packages/shared
git commit -m "feat(backend): bind to loopback and report connected client count"
```

---

### Task 17: Reconnection and session resync

**Files:**
- Modify: `packages/tui/src/net/client.ts`
- Test: `packages/tui/src/net/reconnect.test.ts`

**Interfaces:**
- Consumes: `WsClient` (Task 1).
- Produces: on `WsClient` — `onStatusChange(listener: (status: { connected: boolean }) => void): () => void`, and automatic reconnection with exponential backoff.

Over a tunnel the connection drops whenever the laptop sleeps or changes network, so reconnection is the normal path rather than an error path. Recovery costs nothing extra: each open session re-runs `SessionTerminal.attach()`, which restores the current screen from `SESSION_SNAPSHOT` (Task 9).

- [ ] **Step 1: Write the failing test**

`packages/tui/src/net/reconnect.test.ts`:

```ts
import { describe, test, expect, afterEach } from "bun:test";
import type { Server } from "bun";
import { WsClient } from "./client";

let server: Server<unknown> | null = null;

afterEach(() => {
    server?.stop(true);
    server = null;
});

function serveOn(port: number): Server<unknown> {
    return Bun.serve({
        port,
        fetch(req, s) {
            if (s.upgrade(req, { data: {} })) return undefined;
            return new Response("no");
        },
        websocket: {
            message(ws, raw) {
                const req = JSON.parse(String(raw)) as { correlationId: string; type: string };
                ws.send(
                    JSON.stringify({
                        correlationId: req.correlationId,
                        type: req.type,
                        payload: { ok: true },
                    }),
                );
            },
        },
    });
}

describe("WsClient reconnection", () => {
    test("reports disconnect and reconnects when the server returns", async () => {
        server = serveOn(0);
        const port = server.port ?? 0;

        const client = new WsClient(port);
        await client.connect();

        const states: boolean[] = [];
        client.onStatusChange((status) => states.push(status.connected));

        server.stop(true);
        await Bun.sleep(150);
        expect(states).toContain(false);

        server = serveOn(port);
        await Bun.sleep(1500);
        expect(states).toContain(true);

        const result = await client.request<{ ok: boolean }>("ping");
        expect(result.ok).toBe(true);
        client.close();
    });

    test("stops reconnecting after close", async () => {
        server = serveOn(0);
        const port = server.port ?? 0;
        const client = new WsClient(port);
        await client.connect();
        client.close();

        server.stop(true);
        await Bun.sleep(300);
        await expect(client.request("ping")).rejects.toThrow();
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/tui/src/net/reconnect.test.ts`
Expected: FAIL — `onStatusChange` is not a function.

- [ ] **Step 3: Add reconnection to `WsClient`**

Task 1 already provides `onStatusChange`, `notifyStatus` and `failPending`, and
already clears `this.ws` on close. This step adds only the retry loop and the
host parameter that Task 18 needs.

Add the backoff ceiling beside `REQUEST_TIMEOUT_MS`:

```ts
const MAX_RECONNECT_DELAY_MS = 5_000;
```

Add three fields and widen the constructor:

```ts
    private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    private reconnectAttempt = 0;
    private closed = false;

    constructor(
        private readonly port: number,
        private readonly host = "127.0.0.1",
    ) {}
```

Use the host in `connect()`:

```ts
            const ws = new WebSocket(`ws://${this.host}:${String(this.port)}`);
```

Reset the attempt counter once a connection succeeds, inside `ws.onopen`:

```ts
                this.reconnectAttempt = 0;
```

Schedule a retry from `ws.onclose`, after the existing `notifyStatus(false)` and
`failPending(...)` calls:

```ts
                this.scheduleReconnect();
```

Add the scheduler itself:

```ts
    private scheduleReconnect(): void {
        if (this.closed || this.reconnectTimer !== null) return;
        const delay = Math.min(250 * 2 ** this.reconnectAttempt, MAX_RECONNECT_DELAY_MS);
        this.reconnectAttempt++;
        this.reconnectTimer = setTimeout(() => {
            this.reconnectTimer = null;
            void this.connect().catch(() => {
                this.scheduleReconnect();
            });
        }, delay);
    }
```

And make `close()` stop the loop, before the existing `failPending` call:

```ts
    close(): void {
        this.closed = true;
        if (this.reconnectTimer !== null) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }
        this.failPending(new Error("Client closed"));
        const ws = this.ws;
        this.ws = null;
        ws?.close();
    }
```

Two orderings matter here. `this.ws` is cleared before `ws.close()` so the
`onclose` guard sees a superseded socket and does not schedule a reconnect after
an intentional shutdown. And `closed` is set before anything else, so a close
racing an in-flight timer cannot restart the loop.

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test packages/tui/src/net/`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/tui/src/net
git commit -m "feat(tui): reconnect to the backend with backoff"
```

---

### Task 18: Remote mode

**Files:**
- Modify: `packages/tui/src/index.ts`
- Create: `packages/tui/src/cli.ts`
- Test: `packages/tui/src/cli.test.ts`

**Interfaces:**
- Consumes: `startBackend` (Task 2); `WsClient` (Tasks 1, 17); `App` (Task 15).
- Produces: `interface CliOptions { connect: { host: string; port: number } | null }` and `function parseArgs(argv: string[]): CliOptions`.

Argument parsing is a pure function so it can be tested without launching anything.

- [ ] **Step 1: Write the failing test**

`packages/tui/src/cli.test.ts`:

```ts
import { describe, test, expect } from "bun:test";
import { parseArgs } from "./cli";

describe("parseArgs", () => {
    test("defaults to local mode", () => {
        expect(parseArgs([])).toEqual({ connect: null });
    });

    test("parses host and port from --connect", () => {
        expect(parseArgs(["--connect", "127.0.0.1:7777"])).toEqual({
            connect: { host: "127.0.0.1", port: 7777 },
        });
    });

    test("accepts --connect=host:port", () => {
        expect(parseArgs(["--connect=desktop.local:9000"])).toEqual({
            connect: { host: "desktop.local", port: 9000 },
        });
    });

    test("rejects a target with no port", () => {
        expect(() => parseArgs(["--connect", "desktop"])).toThrow(/host:port/);
    });

    test("rejects a non-numeric port", () => {
        expect(() => parseArgs(["--connect", "desktop:abc"])).toThrow(/host:port/);
    });

    test("rejects a port with trailing garbage", () => {
        // parseInt alone would accept this as 123.
        expect(() => parseArgs(["--connect", "desktop:123abc"])).toThrow(/host:port/);
    });

    test("rejects an out-of-range port", () => {
        expect(() => parseArgs(["--connect", "desktop:99999"])).toThrow(/host:port/);
    });

    test("rejects an unknown flag", () => {
        expect(() => parseArgs(["--nope"])).toThrow(/Unknown/);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test packages/tui/src/cli.test.ts`
Expected: FAIL — cannot resolve module `./cli`.

- [ ] **Step 3: Write `cli.ts`**

```ts
interface CliOptions {
    connect: { host: string; port: number } | null;
}

const USAGE = "usage: taskflow-tui [--connect <host:port>]";

function parseTarget(value: string): { host: string; port: number } {
    const separator = value.lastIndexOf(":");
    if (separator <= 0) throw new Error(`--connect expects host:port. ${USAGE}`);
    const host = value.slice(0, separator);
    const rawPort = value.slice(separator + 1);
    // parseInt would accept "123abc" as 123, so require digits only.
    if (!/^\d+$/.test(rawPort)) throw new Error(`--connect expects host:port. ${USAGE}`);
    const port = Number.parseInt(rawPort, 10);
    if (port < 1 || port > 65535) throw new Error(`--connect expects host:port. ${USAGE}`);
    return { host, port };
}

function parseArgs(argv: string[]): CliOptions {
    let connect: CliOptions["connect"] = null;

    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i] ?? "";
        if (arg.startsWith("--connect=")) {
            connect = parseTarget(arg.slice("--connect=".length));
            continue;
        }
        if (arg === "--connect") {
            const value = argv[i + 1];
            if (value === undefined) throw new Error(`--connect expects host:port. ${USAGE}`);
            connect = parseTarget(value);
            i++;
            continue;
        }
        throw new Error(`Unknown argument: ${arg}. ${USAGE}`);
    }

    return { connect };
}

export { parseArgs };
export type { CliOptions };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test packages/tui/src/cli.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Branch on the mode in `index.ts`**

`WsClient` already accepts a host from Task 17, so only `index.ts` changes here.
Replace the backend-and-client setup at the top of `main()` with:

```ts
    const options = parseArgs(process.argv.slice(2));

    let backend: { port: number; stop(): void } | null = null;
    let net: WsClient;

    if (options.connect === null) {
        const devBranch = process.env.TASKFLOW_DEV_BRANCH ?? null;
        const binary = process.env.TASKFLOW_BACKEND_BIN ?? "taskflow-backend";
        backend = await startBackend({ binary, args: [], devBranch });
        net = new WsClient(backend.port);
    } else {
        net = new WsClient(options.connect.port, options.connect.host);
    }

    await net.connect();
```

and make shutdown tolerate the remote case, where there is no child to kill:

```ts
            ttyReal.leave();
            net.close();
            backend?.stop();
            process.exit(0);
```

- [ ] **Step 6: Resync sessions on reconnect and warn about other clients**

In `App`, subscribe to both signals in `init()`:

```ts
        this.deps.net.onStatusChange((status) => {
            if (!status.connected) return;
            // The backend keeps the PTY alive across a dropped connection, so a
            // reconnect only has to re-fetch each session's current screen.
            void this.deps.store.load().catch(() => undefined);
            for (const session of this.sessions) {
                void session.term.attach().catch(() => undefined);
            }
        });

        this.disposers.push(
            this.deps.net.on(MSG.SYSTEM_CLIENTS, (payload) => {
                const event = payload as SystemClientsEvent;
                this.otherClients = Math.max(0, event.count - 1);
            }),
        );
```

backed by two new fields and a disposer list on the class:

```ts
    private otherClients = 0;
    private readonly disposers: Array<() => void> = [];
```

and rendered as a banner on the tab row in `render()`, after `drawTabs`:

```ts
        if (this.otherClients > 0) {
            const warning = ` ${String(this.otherClients)} other client(s) attached `;
            const startX = Math.max(paneX, cols - warning.length);
            for (let i = 0; i < warning.length && startX + i < cols; i++) {
                screen.back.set(startX + i, 0, {
                    ...blankCell(),
                    ch: warning[i] ?? " ",
                    attrs: ATTR_INVERSE,
                });
            }
        }
```

importing `blankCell` and `ATTR_INVERSE` from `../render/cells`, and
`SystemClientsEvent` from `@taskflow/shared`.

The banner exists because a session has one terminal grid on the backend and the
last resize wins. When the desktop app is attached to the same session at a
different size, one of the two renders incorrectly; the banner tells the user why
rather than leaving it a mystery.

- [ ] **Step 7: Manual smoke test over a tunnel**

On the machine running the backend, confirm it is on loopback only:

```bash
lsof -nP -iTCP -sTCP:LISTEN | grep taskflow    # expect 127.0.0.1:<port>
```

From the second machine:

```bash
ssh -N -L 7777:127.0.0.1:<port> <desktop-host> &
taskflow-tui --connect 127.0.0.1:7777
```

Verify:
1. The sidebar lists the projects that live on the desktop.
2. Killing the `ssh` process shows a disconnected state, and restarting the
   tunnel reconnects without restarting the TUI.
3. With the desktop app also open, the banner reports another client attached.

- [ ] **Step 8: Run the full check and commit**

```bash
bun run lint && bun run typecheck && bun test
git add packages/tui
git commit -m "feat(tui): connect to a remote backend over a tunnel"
```

## What this stage does not do

These are deliberate omissions, each deferred to a named stage. Do not close
them by extending Task 15 — that would put untested behavior in the wiring
layer, which is the one file with no unit tests.

**Session creation and attach.** `App.sessions` starts empty, so Task 15's smoke
test covers navigation and terminal restoration only. `SESSION_CREATE` and
attaching to a task's existing sessions are the first tasks of Stage 2. Every
piece they need — `SessionTerminal`, `blitTerminal`, `encodeForChild` — is built
and tested here.

**Two of the four child modes.** `ChildModes` carries `applicationCursorKeys`,
`bracketedPaste` and `kittyFlags`. The spec's encode table also lists
`sendFocusMode` (emit `CSI I` / `CSI O` on pane focus change) and
`mouseTrackingMode` (forward mouse reports in the requested encoding). Both need
a focused, attached session to be meaningful, so they land in Stage 2 alongside
session lifecycle. When adding them, extend `ChildModes` rather than threading
the terminal through `encodeForChild` — that separation is what keeps the
encoder a pure function.

**Terminal resize.** `index.ts` reads `process.stdout.columns`/`rows` once at
startup and never listens for `SIGWINCH`. Resizing the window mid-session will
misrender until restart. Handling it means calling `Screen.resize`, recomputing
the pane rect and calling `SessionTerminal.resize` for every open session — all
of which exist and are tested here, but which have nothing to resize until
Stage 2 opens a session.

**The dirty flag.** The spec calls for rendering driven by a dirty flag on a
60fps cap. Stage 1's loop calls `App.render()` unconditionally every 16ms and
relies on `Screen`'s frame diff to emit nothing when nothing changed — which the
"a second identical frame writes nothing" test pins down. That is correct but
wastes a buffer walk per tick. Add the dirty flag in Stage 2, when live session
output makes the difference measurable.

## Follow-up stages

**Stage 2 — Sessions and flows.** Session create, close, resume and tab management; OSC 52 clipboard, which matters once the terminal is on a different machine from the backend; flow definitions, runs and controls; actions; schedules; the YAML-through-`$EDITOR` record editor.

**Stage 3 — Git and settings.** The changes pane with staging and commit, agent-generated commit messages, settings pickers fed by the backend's detection endpoints, task detail with the task log and attributes, and `notify-send` notifications.

Each gets its own plan written from the same spec.
