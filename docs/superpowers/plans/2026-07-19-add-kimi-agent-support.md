# Add Kimi Code Agent Support — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Kimi Code (`kimi` CLI) as a fully supported agent type in taskflow, and close the New Task dialog / flow editor / tray-tracking gaps for both Pi and Kimi.

**Architecture:** Kimi follows the established per-agent recipe (discriminated launch-options union + `buildAgentLaunchSpec` branch + detection + settings + UI components). Because kimi has no CLI channel for a system prompt or an interactive initial prompt, the composite Taskflow prompt is delivered by writing into the session PTY (bracketed paste + Enter) once the TUI goes quiet — a new `initialInput` capability added to `PtyManager`.

**Tech Stack:** Bun, TypeScript, React, Bun test. Spec: `docs/superpowers/specs/2026-07-19-add-kimi-agent-support-design.md`.

## Global Constraints

- Use `bun` for everything (`bun test`, `bun run typecheck`, `bun run lint`). Never npm/yarn.
- No `as any`. No new eslint suppressions. No exports that nothing imports.
- Work directly on `main` (no worktree/branch).
- Kimi CLI facts (v0.27.0, verified): flags `--model <alias>`, `--auto`, `--yolo` (`--auto` and `--yolo` are mutually exclusive); models listed by `kimi provider list --json` (clean JSON on stdout); version via `kimi --version` (stdout, e.g. `0.27.0`). No `--plan` exposure (out of scope per spec). Binary lives in `~/.kimi-code/bin` (on PATH via `.zshrc`; `buildShellPath()` picks it up).
- New permission-mode value set everywhere: `"manual" | "auto" | "yolo"`. `manual` = no flag.
- Every task ends with `bun run typecheck` passing. Commit after each task, message style `feat(scope): ...` / `test(scope): ...`, **no Co-Authored-By lines**.

---

### Task 1: Shared types and constants

**Files:**
- Modify: `packages/shared/src/types/agent.ts`
- Modify: `packages/shared/src/types/settings.ts`
- Modify: `packages/shared/src/constants.ts:43` (MSG map)
- Modify: `packages/shared/src/types/ws.ts:137,256`
- Modify: `packages/shared/src/types/flow.ts:3`
- Modify: `packages/shared/src/types/task.ts:5`

**Interfaces:**
- Produces: `AgentType` includes `"kimi"`; `KimiPermissionMode = "manual" | "auto" | "yolo"`; `KimiLaunchOptions { type: "kimi"; model?: string; permissionMode?: KimiPermissionMode }`; `KimiModelInfo { id: string; displayName: string; contextWindow: string }`; `KimiSettings { defaultModel: string; permissionMode: KimiPermissionMode }`; `MSG.KIMI_MODELS === "kimi:models"`; `KimiModelsResponse { models: KimiModelInfo[] }`. All later tasks consume these names verbatim.

- [ ] **Step 1: Extend `packages/shared/src/types/agent.ts`**

At the top (lines 1–12), add `"kimi"` to the union, array, and display names:

```ts
type AgentType = "claude" | "codex" | "opencode" | "gemini" | "cursor" | "pi" | "kimi";

const ALL_AGENT_TYPES: AgentType[] = ["claude", "codex", "opencode", "gemini", "cursor", "pi", "kimi"];

const AGENT_DISPLAY_NAMES: Record<AgentType, string> = {
    claude: "Claude",
    codex: "Codex",
    opencode: "OpenCode",
    gemini: "Gemini",
    cursor: "Cursor",
    pi: "Pi",
    kimi: "Kimi",
};
```

After the Pi block (after `PiModelInfo`, ~line 121), add:

```ts
const KIMI_PERMISSION_MODES = ["manual", "auto", "yolo"] as const;

type KimiPermissionMode = (typeof KIMI_PERMISSION_MODES)[number];

interface KimiLaunchOptions {
    type: Extract<AgentType, "kimi">;
    /** Model alias key from `kimi provider list --json`, e.g. "kimi-code/k3" — passed to `--model`. */
    model?: string;
    /** "manual" omits flags; "auto" → `--auto`; "yolo" → `--yolo` (CLI rejects both together). */
    permissionMode?: KimiPermissionMode;
}

interface KimiModelInfo {
    /** Alias key, e.g. "kimi-code/k3". */
    id: string;
    /** e.g. "K3". */
    displayName: string;
    /** Display-only string derived from maxContextSize, e.g. "256K". */
    contextWindow: string;
}
```

Add `| KimiLaunchOptions` to the `AgentLaunchOptions` union, add `KIMI_PERMISSION_MODES` to the value `export {}` block (next to `CLAUDE_PERMISSION_MODES`), and add `KimiPermissionMode`, `KimiLaunchOptions`, `KimiModelInfo` to the `export type {}` block.

- [ ] **Step 2: Extend `packages/shared/src/types/settings.ts`**

After `PiSettings` (~line 51):

```ts
export interface KimiSettings {
    defaultModel: string;
    permissionMode: KimiPermissionMode;
}
```

Add `KimiPermissionMode` to the existing type import from `./agent` (the file already imports `PiThinkingLevel` from there). Add `kimi: KimiSettings;` to `AppSettings` (after `pi`) and `kimi?: NullablePartial<KimiSettings>;` to `SettingsUpdatePayload` (after `pi`).

- [ ] **Step 3: Extend `packages/shared/src/constants.ts`**

After `PI_MODELS: "pi:models",` (line 43):

```ts
    KIMI_MODELS: "kimi:models",
```

- [ ] **Step 4: Extend `packages/shared/src/types/ws.ts`**

Add `"kimi"` to `SessionCreatePayload.type` (line ~137: `type: "claude" | "codex" | "opencode" | "gemini" | "cursor" | "pi" | "kimi" | "shell" | "editor";`). After `PiModelsResponse` (~line 256):

```ts
export interface KimiModelsResponse {
    models: KimiModelInfo[];
}
```

(add `KimiModelInfo` to the file's type import from `./agent`, next to `PiModelInfo`).

- [ ] **Step 5: Extend `flow.ts` and `task.ts` unions**

`packages/shared/src/types/flow.ts:3`:

```ts
type SessionType = "claude" | "codex" | "opencode" | "gemini" | "cursor" | "pi" | "kimi" | "shell";
```

`packages/shared/src/types/task.ts:5` (`SessionRef.type`): insert `| "kimi"` after `"pi"`, keeping `"shell" | "editor"`.

- [ ] **Step 6: Typecheck — expect known downstream errors, fix only shared**

Run: `bun run typecheck`
Expected: `packages/shared` passes. Backend/UI may now fail on non-exhaustive switches (`settingsToAgentOptions`, `mergeAgentOptions`, `AppSettings` literals in `settings-store.ts`, etc.) — these are fixed in Tasks 3–8. If backend/UI errors appear, that's acceptable for this commit **only if** they are the known exhaustiveness errors; note them for later tasks.

- [ ] **Step 7: Commit**

```bash
git add packages/shared
git commit -m "feat(shared): add kimi agent type, launch options, settings, and ws types"
```

---

### Task 2: Runtime detection and model listing (backend)

**Files:**
- Modify: `packages/backend/src/services/runtime-detector.ts` (KNOWN_AGENTS ~line 86; new functions after `fetchPiModels` ~line 352; type import at top)
- Modify: `packages/backend/src/index.ts` (import ~line 18; register after `MSG.PI_MODELS` ~line 405)
- Test: `packages/backend/tests/services/runtime-detector.test.ts`

**Interfaces:**
- Consumes: `KimiModelInfo`, `MSG.KIMI_MODELS` (Task 1).
- Produces: `parseKimiModelsOutput(output: string): KimiModelInfo[]`, `fetchKimiModels(): Promise<KimiModelInfo[]>` exported from `runtime-detector.ts`.

- [ ] **Step 1: Write failing tests**

Append to `packages/backend/tests/services/runtime-detector.test.ts` (add `parseKimiModelsOutput` to the existing import from `../../src/services/runtime-detector`):

```ts
describe("parseKimiModelsOutput", () => {
    const FIXTURE = JSON.stringify({
        providers: { "managed:kimi-code": { type: "kimi" } },
        models: {
            "kimi-code/kimi-for-coding": {
                provider: "managed:kimi-code",
                model: "kimi-for-coding",
                maxContextSize: 262144,
                capabilities: ["thinking", "tool_use"],
                displayName: "K2.7 Coding",
            },
            "kimi-code/k3": {
                provider: "managed:kimi-code",
                model: "k3",
                maxContextSize: 262144,
                displayName: "K3",
            },
        },
    });

    it("parses the models map into KimiModelInfo entries", () => {
        const models = parseKimiModelsOutput(FIXTURE);
        expect(models).toHaveLength(2);
        expect(models[0]).toEqual({
            id: "kimi-code/kimi-for-coding",
            displayName: "K2.7 Coding",
            contextWindow: "256K",
        });
        expect(models[1]).toEqual({ id: "kimi-code/k3", displayName: "K3", contextWindow: "256K" });
    });

    it("falls back to the model field, then the alias id, when displayName is missing", () => {
        const withModel = parseKimiModelsOutput(
            JSON.stringify({ models: { "kimi-code/x": { model: "x", maxContextSize: 131072 } } }),
        );
        expect(withModel).toEqual([{ id: "kimi-code/x", displayName: "x", contextWindow: "128K" }]);
        const bare = parseKimiModelsOutput(
            JSON.stringify({ models: { "kimi-code/y": { maxContextSize: 131072 } } }),
        );
        expect(bare).toEqual([{ id: "kimi-code/y", displayName: "kimi-code/y", contextWindow: "128K" }]);
    });

    it("returns empty for malformed JSON, non-object, and missing models", () => {
        expect(parseKimiModelsOutput("not json")).toEqual([]);
        expect(parseKimiModelsOutput('"str"')).toEqual([]);
        expect(parseKimiModelsOutput("{}")).toEqual([]);
        expect(parseKimiModelsOutput("")).toEqual([]);
    });

    it("omits contextWindow when maxContextSize is absent or invalid", () => {
        const models = parseKimiModelsOutput(
            JSON.stringify({ models: { "kimi-code/y": { displayName: "Y", maxContextSize: "big" } } }),
        );
        expect(models).toEqual([{ id: "kimi-code/y", displayName: "Y", contextWindow: "" }]);
    });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/backend && bun test tests/services/runtime-detector.test.ts`
Expected: FAIL — `parseKimiModelsOutput` is not exported.

- [ ] **Step 3: Implement**

In `runtime-detector.ts`: add `KimiModelInfo` to the `@taskflow/shared` type import; add `"kimi"` to `KNOWN_AGENTS`:

```ts
const KNOWN_AGENTS: AgentType[] = ["claude", "codex", "opencode", "gemini", "cursor", "pi", "kimi"];
```

After `fetchPiModels`:

```ts
export function parseKimiModelsOutput(output: string): KimiModelInfo[] {
    let parsed: unknown;
    try {
        parsed = JSON.parse(output);
    } catch {
        return [];
    }
    if (typeof parsed !== "object" || parsed === null) return [];
    const models = (parsed as { models?: unknown }).models;
    if (typeof models !== "object" || models === null) return [];
    return Object.entries(models as Record<string, unknown>).map(([id, value]) => {
        const entry =
            typeof value === "object" && value !== null
                ? (value as { displayName?: unknown; model?: unknown; maxContextSize?: unknown })
                : {};
        const displayName =
            typeof entry.displayName === "string" && entry.displayName
                ? entry.displayName
                : typeof entry.model === "string" && entry.model
                  ? entry.model
                  : id;
        const contextWindow =
            typeof entry.maxContextSize === "number" && entry.maxContextSize > 0
                ? `${Math.round(entry.maxContextSize / 1024)}K`
                : "";
        return { id, displayName, contextWindow };
    });
}

export async function fetchKimiModels(): Promise<KimiModelInfo[]> {
    const output = await runCliCommand("kimi", ["provider", "list", "--json"]);
    if (!output) return [];
    return parseKimiModelsOutput(output);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/backend && bun test tests/services/runtime-detector.test.ts`
Expected: PASS (all pre-existing + 4 new).

- [ ] **Step 5: Register the WS endpoint**

In `packages/backend/src/index.ts`: add `fetchKimiModels` to the `runtime-detector` import list, and after the `MSG.PI_MODELS` registration add:

```ts
        router.register(MSG.KIMI_MODELS, async () => ({
            models: await fetchKimiModels(),
        }));
```

Also add `| "kimi"` to the scheduled-session inline type cast at `index.ts:131-138` (after `| "pi"`).

- [ ] **Step 6: Commit**

```bash
git add packages/backend/src/services/runtime-detector.ts packages/backend/src/index.ts packages/backend/tests/services/runtime-detector.test.ts
git commit -m "feat(backend): detect kimi agent and list models via provider list --json"
```

---

### Task 3: Launch spec — kimi branch with `initialInput`

**Files:**
- Modify: `packages/backend/src/services/internal-agent-skill.ts:187-195` (signature) and add branch after the pi branch (~line 305)
- Test: `packages/backend/tests/services/internal-agent-skill.test.ts`

**Interfaces:**
- Consumes: `KimiLaunchOptions` (Task 1).
- Produces: `buildAgentLaunchSpec` accepts `type: "kimi"`, and its return type gains `initialInput?: string` — Task 5 forwards it into the PTY spawn (Task 4 implements the PTY side).

- [ ] **Step 1: Write failing tests**

Append to `packages/backend/tests/services/internal-agent-skill.test.ts` (match the file's existing import/call style — `buildAgentLaunchSpec(type, prompt, skillPath, agentOptions, ...)` with skillPath `"/tmp/taskflow-internal-api/SKILL.md"`):

```ts
describe("buildAgentLaunchSpec kimi", () => {
    const SKILL = "/tmp/taskflow-internal-api/SKILL.md";

    it("launches kimi with model and --auto, no prompt args", () => {
        const spec = buildAgentLaunchSpec("kimi", undefined, SKILL, {
            type: "kimi",
            model: "kimi-code/k3",
            permissionMode: "auto",
        });
        expect(spec.command).toBe("kimi");
        expect(spec.args).toEqual(["--model", "kimi-code/k3", "--auto"]);
        expect(spec.env).toEqual({ KIMI_CODE_NO_AUTO_UPDATE: "1" });
        expect(spec.initialInput).toBeUndefined();
    });

    it("maps yolo permission mode and omits flags for manual", () => {
        const yolo = buildAgentLaunchSpec("kimi", undefined, SKILL, {
            type: "kimi",
            permissionMode: "yolo",
        });
        expect(yolo.args).toEqual(["--yolo"]);
        const manual = buildAgentLaunchSpec("kimi", undefined, SKILL, {
            type: "kimi",
            permissionMode: "manual",
        });
        expect(manual.args).toEqual([]);
    });

    it("composes initialInput from system prompt and prompt", () => {
        const spec = buildAgentLaunchSpec("kimi", "do the thing", SKILL, { type: "kimi" });
        expect(spec.args).toEqual([]);
        expect(spec.initialInput).toBeDefined();
        expect(spec.initialInput).toContain("do the thing");
        expect(spec.initialInput).toContain("taskflow-cli");
        // system context precedes the user prompt
        expect(spec.initialInput!.indexOf("taskflow-cli")).toBeLessThan(
            spec.initialInput!.indexOf("do the thing"),
        );
    });

    it("appends additionalSystemPrompt into initialInput", () => {
        const spec = buildAgentLaunchSpec(
            "kimi",
            "prompt",
            SKILL,
            { type: "kimi" },
            "EXTRA CONTEXT",
        );
        expect(spec.initialInput).toContain("EXTRA CONTEXT");
    });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/backend && bun test tests/services/internal-agent-skill.test.ts`
Expected: FAIL — type error / `"kimi"` not assignable, no kimi branch.

- [ ] **Step 3: Implement**

In `internal-agent-skill.ts`, extend the signature (line 188) and return type (line 195):

```ts
export function buildAgentLaunchSpec(
    type: "claude" | "codex" | "opencode" | "gemini" | "cursor" | "pi" | "kimi",
    prompt: string | undefined,
    skillPath: string,
    agentOptions?: AgentLaunchOptions,
    additionalSystemPrompt?: string,
    isProjectScope?: boolean,
    isFlowScope?: boolean,
): { command: string; args: string[]; env?: Record<string, string>; initialInput?: string } {
```

After the `if (type === "pi") { ... }` branch (before the Codex fallthrough), add:

```ts
    if (type === "kimi") {
        const optionArgs: string[] = [];
        if (agentOptions?.type === "kimi") {
            if (agentOptions.model) optionArgs.push("--model", agentOptions.model);
            if (agentOptions.permissionMode === "auto") optionArgs.push("--auto");
            else if (agentOptions.permissionMode === "yolo") optionArgs.push("--yolo");
        }
        // Kimi has no system-prompt or interactive-prompt CLI channel; the composite
        // prompt is typed into the TUI by the PTY layer via initialInput.
        return {
            command: "kimi",
            args: optionArgs,
            env: { KIMI_CODE_NO_AUTO_UPDATE: "1" },
            initialInput: prompt ? `${systemPrompt}\n\n---\n\n${prompt}` : undefined,
        };
    }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/backend && bun test tests/services/internal-agent-skill.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/backend/src/services/internal-agent-skill.ts packages/backend/tests/services/internal-agent-skill.test.ts
git commit -m "feat(backend): kimi launch spec with PTY-delivered initial input"
```

---

### Task 4: PTY initial-input injection

**Files:**
- Modify: `packages/backend/src/services/pty-manager.ts` (`SpawnOptions` ~line 10, `Session` interface ~line 92, `spawn()` ~line 108, `close()` ~line 236)
- Test: `packages/backend/tests/services/pty-manager.test.ts` (append — the file EXISTS; follow its conventions: `it` from `bun:test`, `isWindows`/`testCwd` consts, `it.skipIf(isWindows)` for POSIX-only cases, `manager.closeAll()` in `afterEach`)

**Interfaces:**
- Consumes: nothing new.
- Produces: `SpawnOptions.initialInput?: string` — after spawn, once the process has produced output AND then been quiet for 500 ms (or 10 s after spawn regardless, covering processes that never print), the PTY receives `\x1b[200~<initialInput>\x1b[201~` followed 50 ms later by `\r`. Task 5 passes `spec.initialInput` through.

- [ ] **Step 1: Write failing tests**

Append a new `describe` block to the EXISTING `packages/backend/tests/services/pty-manager.test.ts`, reusing the file's top-level `isWindows` and `testCwd` constants:

```ts
describe("PtyManager initialInput", () => {
    const manager = new PtyManager();

    afterEach(() => {
        manager.closeAll();
    });

    it.skipIf(isWindows)(
        "injects initial input once startup output goes quiet, then submits it",
        async () => {
            let output = "";
            manager.spawn({
                // prints startup output like a TUI, then echoes stdin like one
                command: "/bin/sh",
                args: ["-c", "echo booting; exec cat"],
                cwd: testCwd,
                onData: (data) => {
                    output += data;
                },
                onExit: () => {},
                initialInput: "hello injected world",
            });
            // startup output + quiet window (500ms) + submit delay (50ms) + slack
            await new Promise((resolve) => setTimeout(resolve, 2000));
            // `cat` in a PTY echoes the pasted input back
            expect(output).toContain("booting");
            expect(output).toContain("hello injected world");
        },
    );

    it.skipIf(isWindows)("does not write when no initialInput is given", async () => {
        let output = "";
        manager.spawn({
            command: "/bin/cat",
            args: [],
            cwd: testCwd,
            onData: (data) => {
                output += data;
            },
            onExit: () => {},
        });
        await new Promise((resolve) => setTimeout(resolve, 800));
        expect(output).toBe("");
    });

    it.skipIf(isWindows)(
        "close() before the quiet window elapses cancels the pending injection",
        async () => {
            let output = "";
            const id = manager.spawn({
                command: "/bin/sh",
                args: ["-c", "echo booting; exec cat"],
                cwd: testCwd,
                onData: (data) => {
                    output += data;
                },
                onExit: () => {},
                initialInput: "should never appear",
            });
            // close while the quiet window is still pending
            await new Promise((resolve) => setTimeout(resolve, 200));
            manager.close(id);
            await new Promise((resolve) => setTimeout(resolve, 800));
            expect(output).not.toContain("should never appear");
        },
    );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/backend && bun test tests/services/pty-manager.test.ts`
Expected: FAIL — `initialInput` not a known property (typecheck) / output never contains the text.

- [ ] **Step 3: Implement**

In `pty-manager.ts`, extend `SpawnOptions`:

```ts
interface SpawnOptions {
    command: string;
    args: string[];
    cwd: string;
    onData: (data: string, sequence: number) => void;
    onExit: (exitCode: number) => void;
    cols?: number;
    rows?: number;
    env?: Record<string, string>;
    /**
     * Text to type into the PTY once startup output goes quiet — for agents
     * with no CLI flag for an initial prompt (kimi). Sent as a bracketed
     * paste followed by Enter.
     */
    initialInput?: string;
}
```

Add module constants near `MAX_SCROLLBACK`:

```ts
const INITIAL_INPUT_QUIET_MS = 500; // inject after this much output silence
const INITIAL_INPUT_MAX_WAIT_MS = 10_000; // inject regardless after this long
const INITIAL_INPUT_SUBMIT_DELAY_MS = 50; // gap between paste and Enter
```

Inside `spawn()`, before the `DataBatcher` is created (the batcher callback references `scheduleQuietInject`), set up the injection state. The max-wait timer is tracked separately from the quiet-window timer so rescheduling on new output never cancels the hard cap:

```ts
        const initialInput = options.initialInput;
        let injected = initialInput === undefined;
        let quietTimer: ReturnType<typeof setTimeout> | null = null;
        let maxWaitTimer: ReturnType<typeof setTimeout> | null = null;
        let submitTimer: ReturnType<typeof setTimeout> | null = null;

        const cancelInjection = () => {
            if (quietTimer) clearTimeout(quietTimer);
            if (maxWaitTimer) clearTimeout(maxWaitTimer);
            if (submitTimer) clearTimeout(submitTimer);
            quietTimer = maxWaitTimer = submitTimer = null;
        };

        const inject = () => {
            if (injected) return;
            injected = true;
            cancelInjection();
            const session = this.sessions.get(id);
            if (!session || initialInput === undefined) return;
            session.pty.write(`\x1b[200~${initialInput}\x1b[201~`);
            submitTimer = setTimeout(() => {
                this.sessions.get(id)?.pty.write("\r");
            }, INITIAL_INPUT_SUBMIT_DELAY_MS);
        };

        const scheduleQuietInject = () => {
            if (injected) return;
            if (quietTimer) clearTimeout(quietTimer);
            quietTimer = setTimeout(inject, INITIAL_INPUT_QUIET_MS);
        };
```

Then wire it up:

1. In the `DataBatcher` callback (the function passed to `new DataBatcher(...)`), add `scheduleQuietInject();` as the first line. This is the ONLY place quiet scheduling starts, so injection never happens before the process has produced output; every subsequent batch postpones it until the TUI settles.
2. In `cleanup()` add `injected = true; cancelInjection();` before the existing body, so a process exit cancels pending timers.
3. Make cancellation reachable from `close()` (which kills sessions directly WITHOUT running `cleanup`): add an optional member to the `Session` interface (~line 92):

```ts
interface Session {
    pty: PtyHandle;
    scrollback: string[];
    lastSequence: number;
    headless: HeadlessTerminal;
    serializer: SerializeAddon;
    /** Cancels a pending initial-input injection; set only when spawned with initialInput. */
    cancelInitialInput?: () => void;
}
```

Populate it when building `sessionEntry`:

```ts
        sessionEntry = {
            pty,
            scrollback,
            lastSequence,
            headless,
            serializer,
            ...(initialInput !== undefined && {
                cancelInitialInput: () => {
                    injected = true;
                    cancelInjection();
                },
            }),
        };
```

And in `close()` (~line 236), call it before killing:

```ts
    close(id: string): void {
        const session = this.sessions.get(id);
        if (session) {
            session.cancelInitialInput?.();
            session.serializer.dispose();
            session.headless.dispose();
            session.pty.kill();
            this.sessions.delete(id);
        }
    }
```

4. At the end of `spawn()` (after `this.sessions.set(id, sessionEntry)`), start only the hard-cap clock — the quiet window arms itself from the first output batch:

```ts
        if (!injected) {
            maxWaitTimer = setTimeout(inject, INITIAL_INPUT_MAX_WAIT_MS);
        }
        return id;
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/backend && bun test tests/services/pty-manager.test.ts`
Expected: PASS (all pre-existing tests plus the three new ones).

- [ ] **Step 5: Run the full backend suite**

Run: `cd packages/backend && bun test`
Expected: PASS — no regressions (flow-runner and session tests exercise `spawn` without `initialInput`).

- [ ] **Step 6: Commit**

```bash
git add packages/backend/src/services/pty-manager.ts packages/backend/tests/services/pty-manager.test.ts
git commit -m "feat(backend): PTY initial-input injection with quiet-window readiness"
```

---

### Task 5: Session lifecycle + settings store wiring (backend)

**Files:**
- Modify: `packages/backend/src/services/session-lifecycle.ts` (union ~line 38; `isAutonomousAgent`; `settingsToAgentOptions`; `mergeAgentOptions`; `getDefaultSessionLabel`; spawn call ~line 466)
- Modify: `packages/backend/src/services/settings-store.ts` (DEFAULTS ~line 92; `createDefaultSettings`; load-merge ~line 283; `applyNullable` chain ~line 350)

**Interfaces:**
- Consumes: `KimiSettings` (Task 1), `spec.initialInput` (Task 3), `SpawnOptions.initialInput` (Task 4).
- Produces: kimi sessions creatable end-to-end via `createSession({ type: "kimi", ... })`.

- [ ] **Step 1: Wire session-lifecycle**

1. `CreateSessionOpts.type` (line 38): insert `| "kimi"` after `"pi"`.
2. `isAutonomousAgent`: after the `cursor` line add:

```ts
    if (opts.type === "kimi")
        return opts.permissionMode === "auto" || opts.permissionMode === "yolo";
```

3. `settingsToAgentOptions`: after `case "pi"` add:

```ts
        case "kimi": {
            const s = settings.kimi;
            return {
                type: "kimi",
                model: s.defaultModel || undefined,
                permissionMode: s.permissionMode === "manual" ? undefined : s.permissionMode,
            };
        }
```

4. `mergeAgentOptions`: after `case "pi"` add:

```ts
        case "kimi":
            return explicit?.type === "kimi" ? { ...defaults, ...explicit } : defaults;
```

5. `getDefaultSessionLabel`: add `if (type === "kimi") return "Kimi";` after the pi line.
6. Forward `initialInput`: where the launch spec is consumed (`const spec = buildAgentLaunchSpec(...)`, ~line 419), capture it — after `specEnv = spec.env;` add `specInitialInput = spec.initialInput;` with a `let specInitialInput: string | undefined;` declared next to `let specEnv` (~line 331). Then add `initialInput: specInitialInput,` to the `ptyManager.spawn({ ... })` call (next to `env`).

- [ ] **Step 2: Wire settings-store**

In `DEFAULTS` after the `pi` entry:

```ts
    kimi: {
        defaultModel: "",
        permissionMode: "manual",
    },
```

In `createDefaultSettings()` after `pi`: `kimi: { ...DEFAULTS.kimi },`. In the load-merge result object after `pi`: `kimi: { ...defaults.kimi, ...parsed.kimi },`. In the update chain after the `partial.pi` block:

```ts
        if (partial.kimi) {
            applyNullable(current.kimi, partial.kimi);
        }
```

- [ ] **Step 3: Typecheck + backend tests**

Run: `bun run typecheck && cd packages/backend && bun test`
Expected: backend package typechecks clean (all exhaustive switches now satisfied); tests PASS. UI may still have known errors (Tasks 6–8).

- [ ] **Step 4: Commit**

```bash
git add packages/backend/src/services/session-lifecycle.ts packages/backend/src/services/settings-store.ts
git commit -m "feat(backend): kimi session lifecycle, defaults, and settings persistence"
```

---

### Task 6: UI foundation — icon, tab meta, type unions

**Files:**
- Create: `packages/ui/src/components/icons/KimiIcon.tsx`
- Modify: `packages/ui/src/components/workspace/tab-constants.ts`
- Modify: `packages/ui/src/stores/session-helpers.ts` (Tab union ~line 8; `getDefaultSessionLabel`; `usesTerminalActivityStatus`)
- Modify: `packages/ui/src/components/workspace/TabContent.tsx` (`isAlwaysMounted` ~line 21; switch `case "pi"` ~line 69)
- Modify: `packages/ui/src/components/workspace/Workspace.tsx:175,378` (inline unions)
- Modify: `packages/ui/src/components/sidebar/TaskCreationDialogHost.tsx:14,106` (inline unions)
- Modify: `packages/ui/src/lib/normalize-agent-options.ts` (add case after `pi`)

**Interfaces:**
- Consumes: `AgentType`/`KimiLaunchOptions` (Task 1).
- Produces: `KimiIcon` component; `AGENT_META.kimi`; all UI session-type unions accept `"kimi"` (Tasks 7–9 build on this).

- [ ] **Step 1: Create `KimiIcon.tsx`**

Source SVGs: `~/Downloads/k-only-dark.svg` / `k-only-light.svg` — identical except the K-body fill (white vs black), so one component with `currentColor` covers both themes; the blue accent square keeps its brand color:

```tsx
import type { SVGProps } from "react";

function KimiIcon(props: SVGProps<SVGSVGElement>) {
    return (
        <svg viewBox="0 0 24 25" fill="none" xmlns="http://www.w3.org/2000/svg" {...props}>
            <path
                d="M21.7202 0.939941C22.9502 0.939941 23.9502 1.93994 23.9502 3.16994C23.9502 4.39994 22.9502 5.39994 21.7202 5.39994H19.7502C19.6002 5.39994 19.4902 5.27994 19.4902 5.13994V3.16994C19.4902 1.93994 20.4902 0.939941 21.7202 0.939941Z"
                fill="#1783FF"
            />
            <path
                d="M9.39 13.9501L17.82 5.59012C17.98 5.43012 17.89 5.12012 17.68 5.12012H13.14C13.14 5.12012 13.04 5.14012 13 5.18012L3.92 14.1901C3.78 14.3301 3.57 14.2101 3.57 13.9801V5.39012C3.57 5.24012 3.47 5.12012 3.35 5.12012H0.219999C0.0999993 5.12012 0 5.24012 0 5.39012V23.9201C0 24.0701 0.0999993 24.1901 0.219999 24.1901H3.35C3.47 24.1901 3.57 24.0701 3.57 23.9201V20.1401C3.57 20.0601 3.6 19.9801 3.65 19.9301L6.47 17.1401C6.54 17.0701 6.63 17.0601 6.71 17.1101L14.24 22.6501C15.47 23.4801 16.85 23.9901 18.25 24.1401C18.37 24.1501 18.48 24.0301 18.48 23.8701V20.3101C18.48 20.1701 18.4 20.0601 18.29 20.0501C17.47 19.9201 16.66 19.6001 15.94 19.1101L9.42 14.3901C9.28 14.3001 9.27 14.0701 9.39 13.9501Z"
                fill="currentColor"
            />
        </svg>
    );
}

export { KimiIcon };
```

- [ ] **Step 2: Register in `tab-constants.ts`**

Add `import { KimiIcon } from "@/components/icons/KimiIcon";`, then in `AGENT_META` after `pi`: `kimi: { icon: KimiIcon, colorClass: "text-primary" },` and in `tabVariants` type variants after `pi`: `kimi: "text-primary",`.

- [ ] **Step 3: Extend `session-helpers.ts`**

Insert `| "kimi"` after `| "pi"` in the `Tab.type` union. In `getDefaultSessionLabel` add `if (type === "kimi") return "Kimi";` after the pi line. In `usesTerminalActivityStatus` add `type === "kimi" ||` after the `pi` comparison.

- [ ] **Step 4: Extend `TabContent.tsx`**

In `isAlwaysMounted` add `tab.type === "kimi" ||` after the pi line. In the render switch add `case "kimi":` alongside `case "pi":`.

- [ ] **Step 5: Extend inline unions**

- `Workspace.tsx:175` `handleNewTab` type param: insert `| "kimi"` after `"pi"` (before `"browser"`).
- `Workspace.tsx:378` `handleRunTab` type param: insert `| "kimi"` after `"pi"`.
- `TaskCreationDialogHost.tsx:14` `PendingSession.type` and `:106` `handleCreateTask` `startWith`: insert `| "kimi"` after `"pi"` in both.

- [ ] **Step 6: Extend `normalize-agent-options.ts`**

Add `KIMI_PERMISSION_MODES` to the file's `@taskflow/shared` imports (value import, next to the existing type imports), then after `case "pi"`:

```ts
        case "kimi":
            if (agentOptions.type !== "kimi") return undefined;
            return {
                type: "kimi",
                model: agentOptions.model,
                permissionMode:
                    agentOptions.permissionMode &&
                    (KIMI_PERMISSION_MODES as readonly string[]).includes(agentOptions.permissionMode)
                        ? agentOptions.permissionMode
                        : undefined,
            };
```

- [ ] **Step 7: Typecheck and commit**

Run: `bun run typecheck`
Expected: remaining errors only in files owned by Tasks 7–8 (SettingsModal/AgentOptionsPanel), if any. Then:

```bash
git add packages/ui/src/components/icons/KimiIcon.tsx packages/ui/src/components/workspace/tab-constants.ts packages/ui/src/stores/session-helpers.ts packages/ui/src/components/workspace/TabContent.tsx packages/ui/src/components/workspace/Workspace.tsx packages/ui/src/components/sidebar/TaskCreationDialogHost.tsx packages/ui/src/lib/normalize-agent-options.ts
git commit -m "feat(ui): kimi icon, tab metadata, and session type unions"
```

---

### Task 7: Kimi UI components — model select, options, settings section

**Files:**
- Create: `packages/ui/src/components/settings/KimiModelSelect.tsx`
- Create: `packages/ui/src/components/shared/KimiOptions.tsx`
- Create: `packages/ui/src/components/settings/sections/KimiSection.tsx`
- Modify: `packages/ui/src/components/settings/SettingsModal.tsx`

**Interfaces:**
- Consumes: `MSG.KIMI_MODELS`, `KimiModelInfo`, `KimiModelsResponse`, `KimiPermissionMode` (Tasks 1–2).
- Produces: `KimiOptions` props `{ modelValue: string; permissionMode: KimiPermissionMode; onModelChange: (v: string) => void; onPermissionModeChange: (v: KimiPermissionMode) => void; mode?: "defaults" | "session" }` — Task 8 renders it in `AgentOptionsPanel`.

- [ ] **Step 1: Create `KimiModelSelect.tsx`**

Copy the structure of `PiModelSelect.tsx` exactly (Popover + search + custom-value-on-Enter + fetch-on-open + fallback `Input` on fetch failure), with these substitutions:

- Types/messages: `KimiModelInfo`, `KimiModelsResponse`, `MSG.KIMI_MODELS`.
- No `modelKey` helper — kimi's `m.id` is already the full alias; use `m.id` wherever pi used `modelKey(m)`.
- Search filter matches `m.id` and `m.displayName` (lowercased).
- Fallback input placeholder: `"e.g. kimi-code/k3"`.
- Row rendering: primary line `m.displayName`, secondary muted line `m.id` plus `· ${m.contextWindow} ctx` when `contextWindow` is non-empty:

```tsx
                                    <button
                                        key={m.id}
                                        type="button"
                                        className={`hover:bg-accent hover:text-accent-foreground flex w-full cursor-default flex-col items-start gap-0.5 rounded-sm px-2 py-1.5 text-left text-sm outline-hidden ${
                                            m.id === value ? "bg-accent text-accent-foreground" : ""
                                        }`}
                                        onClick={() => handleSelect(m.id)}>
                                        <span className="truncate">{m.displayName}</span>
                                        <span className="text-muted-foreground truncate text-[11px]">
                                            {m.contextWindow ? `${m.id} · ${m.contextWindow} ctx` : m.id}
                                        </span>
                                    </button>
```

Export as `export { KimiModelSelect };`.

- [ ] **Step 2: Create `KimiOptions.tsx`**

Follow the `PiOptions.tsx` pattern (SettingRow layout, LABELS map with `defaults`/`session` modes):

```tsx
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { KimiModelSelect } from "@/components/settings/KimiModelSelect";
import { SettingRow } from "@/components/settings/sections/SettingRow";
import type { KimiPermissionMode } from "@taskflow/shared";

interface KimiOptionsProps {
    modelValue: string;
    permissionMode: KimiPermissionMode;
    onModelChange: (value: string) => void;
    onPermissionModeChange: (value: KimiPermissionMode) => void;
    /** "defaults" shows "Default Model" etc. "session" shows "Model" etc. */
    mode?: "defaults" | "session";
}

const LABELS = {
    defaults: {
        model: "Default Model",
        modelHint: "Pre-selected model when running Kimi sessions",
        permission: "Default Permission Mode",
        permissionHint: "Manual approves in the TUI; Auto (--auto) and Yolo (--yolo) skip approvals",
    },
    session: {
        model: "Model",
        modelHint: "Model for Kimi session (--model)",
        permission: "Permission Mode",
        permissionHint: "Manual approves in the TUI; Auto (--auto) and Yolo (--yolo) skip approvals",
    },
};

const PERMISSION_OPTIONS: { value: KimiPermissionMode; label: string }[] = [
    { value: "manual", label: "Manual" },
    { value: "auto", label: "Auto (--auto)" },
    { value: "yolo", label: "Yolo (--yolo)" },
];

function KimiOptions({
    modelValue,
    permissionMode,
    onModelChange,
    onPermissionModeChange,
    mode = "session",
}: KimiOptionsProps) {
    const l = LABELS[mode];

    return (
        <>
            <SettingRow label={l.model} hint={l.modelHint}>
                <KimiModelSelect value={modelValue} onChange={onModelChange} />
            </SettingRow>
            <SettingRow label={l.permission} hint={l.permissionHint}>
                <Select
                    value={permissionMode}
                    onValueChange={(v) => onPermissionModeChange(v as KimiPermissionMode)}>
                    <SelectTrigger size="sm" className="w-[180px] text-[13px]">
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        {PERMISSION_OPTIONS.map((opt) => (
                            <SelectItem key={opt.value} value={opt.value}>
                                {opt.label}
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>
            </SettingRow>
        </>
    );
}

export { KimiOptions };
```

- [ ] **Step 3: Create `KimiSection.tsx`**

```tsx
import { KimiOptions } from "@/components/shared/KimiOptions";
import type { KimiPermissionMode } from "@taskflow/shared";

interface KimiSectionProps {
    defaultModel: string;
    permissionMode: KimiPermissionMode;
    onModelChange: (value: string) => void;
    onPermissionModeChange: (value: KimiPermissionMode) => void;
}

function KimiSection({
    defaultModel,
    permissionMode,
    onModelChange,
    onPermissionModeChange,
}: KimiSectionProps) {
    return (
        <KimiOptions
            mode="defaults"
            modelValue={defaultModel}
            permissionMode={permissionMode}
            onModelChange={onModelChange}
            onPermissionModeChange={onPermissionModeChange}
        />
    );
}

export { KimiSection };
```

- [ ] **Step 4: Wire `SettingsModal.tsx`**

1. `import { KimiSection } from "./sections/KimiSection";` (after PiSection import, line 39).
2. `SectionKey` union: add `| "kimi"` after `| "pi"` (line ~52).
3. `handleDefaultAgent` (~line 260): add `value === "kimi" ||` after the `value === "pi"` line.
4. After the Pi handlers (~line 431), add (import `KimiPermissionMode` type from `@taskflow/shared` alongside `PiThinkingLevel`):

```tsx
    const handleKimiModel = useCallback(
        (defaultModel: string) => {
            void updateSettings({ kimi: { defaultModel } });
        },
        [updateSettings],
    );

    const handleKimiPermissionMode = useCallback(
        (permissionMode: KimiPermissionMode) => {
            void updateSettings({ kimi: { permissionMode } });
        },
        [updateSettings],
    );
```

5. `navItems` (~line 455): add `{ key: "kimi", label: "Kimi" },` after the pi entry.
6. After the `section === "pi"` block (~line 602), add:

```tsx
                        {section === "kimi" && (
                            <div className="flex flex-col gap-3 p-3">
                                <KimiSection
                                    defaultModel={settings.kimi.defaultModel}
                                    permissionMode={settings.kimi.permissionMode}
                                    onModelChange={handleKimiModel}
                                    onPermissionModeChange={handleKimiPermissionMode}
                                />
                            </div>
                        )}
```

- [ ] **Step 5: Typecheck and commit**

Run: `bun run typecheck`
Expected: PASS except `AgentOptionsPanel` if it errors (Task 8).

```bash
git add packages/ui/src/components/settings/KimiModelSelect.tsx packages/ui/src/components/shared/KimiOptions.tsx packages/ui/src/components/settings/sections/KimiSection.tsx packages/ui/src/components/settings/SettingsModal.tsx
git commit -m "feat(ui): kimi model select, options component, and settings section"
```

---

### Task 8: AgentOptionsPanel wiring

**Files:**
- Modify: `packages/ui/src/components/workspace/AgentOptionsPanel.tsx`

**Interfaces:**
- Consumes: `KimiOptions` (Task 7), `KimiPermissionMode` (Task 1).
- Produces: `AgentOptionsPanel agentType="kimi"` renders kimi controls and emits `{ type: "kimi", model?, permissionMode? }`.

- [ ] **Step 1: Wire kimi into the panel**

1. Imports: add `type KimiPermissionMode` to the `@taskflow/shared` type import; add `import { KimiOptions } from "@/components/shared/KimiOptions";`.
2. Settings selector after `piSettings`: `const kimiSettings = useSettingsStore((s) => s.settings?.kimi);`.
3. After the Pi defaults block:

```tsx
    // --- Kimi-specific defaults ---
    const defaultKimiPermissionMode: KimiPermissionMode =
        matchingValue?.type === "kimi"
            ? (matchingValue.permissionMode ?? kimiSettings?.permissionMode ?? "manual")
            : (kimiSettings?.permissionMode ?? "manual");
```

4. In the `defaultModel` chain, add both branches following the pi pattern: `agentType === "kimi" && matchingValue?.type === "kimi" ? (matchingValue.model ?? kimiSettings?.defaultModel ?? "")` in the matching-value half, and `agentType === "kimi" ? (kimiSettings?.defaultModel ?? "")` in the fallback half (insert each directly after the corresponding `pi` branch).
5. State: `const [kimiPermissionMode, setKimiPermissionMode] = useState<KimiPermissionMode>(defaultKimiPermissionMode);`.
6. Reset `useEffect`: add branch

```tsx
        } else if (agentType === "kimi") {
            setKimiPermissionMode(defaultKimiPermissionMode);
            setModel(defaultModel);
        }
```

and add `defaultKimiPermissionMode` to the dependency array.
7. Builder:

```tsx
    const buildKimiOptions = useCallback(
        (): AgentLaunchOptions => ({
            type: "kimi",
            model: model || undefined,
            permissionMode: kimiPermissionMode === "manual" ? undefined : kimiPermissionMode,
        }),
        [model, kimiPermissionMode],
    );
```

8. `buildOptions`: add `if (agentType === "kimi") return buildKimiOptions();` before the codex fallback return, and `buildKimiOptions` to the dependency array.
9. JSX: after the pi branch add:

```tsx
            ) : agentType === "kimi" ? (
                <KimiOptions
                    modelValue={model}
                    permissionMode={kimiPermissionMode}
                    onModelChange={setModel}
                    onPermissionModeChange={setKimiPermissionMode}
                />
```

- [ ] **Step 2: Typecheck + lint, commit**

Run: `bun run typecheck && bun run lint`
Expected: both clean across the repo.

```bash
git add packages/ui/src/components/workspace/AgentOptionsPanel.tsx
git commit -m "feat(ui): kimi session options in AgentOptionsPanel"
```

---

### Task 9: Gap closure — New Task dialog, flow editors, tray (Pi + Kimi)

**Files:**
- Modify: `packages/ui/src/components/sidebar/NewTaskDialog.tsx`
- Modify: `packages/ui/src/components/flows/ActionEditor.tsx`
- Modify: `packages/ui/src/components/flows/InlineActionEditor.tsx:57-63`
- Modify: `packages/backend/src/services/tray-state-tracker.ts:26-36`
- Test: `packages/backend/src/services/__tests__/tray-state-tracker.test.ts`

**Interfaces:**
- Consumes: unions from Tasks 1 and 6 (already include both `"pi"` and `"kimi"`).
- Produces: Pi and Kimi selectable at task creation and in flow actions; their sessions tracked for tray activity.

- [ ] **Step 1: Tray tracker — failing test first**

Append to `packages/backend/src/services/__tests__/tray-state-tracker.test.ts` — note the file imports `test` (not `it`) from `bun:test`:

```ts
    test("tracks activity for pi and kimi sessions", () => {
        const tracker = new TrayStateTracker();
        tracker.registerSession("pi-1", "pi");
        tracker.registerSession("kimi-1", "kimi");
        tracker.markSessionActivity("pi-1");
        tracker.markSessionActivity("kimi-1");
        expect(tracker.getSessionStatus("pi-1")).toBe("working");
        expect(tracker.getSessionStatus("kimi-1")).toBe("working");
    });
```

Run: `cd packages/backend && bun test src/services/__tests__/tray-state-tracker.test.ts`
Expected: FAIL — both stay `"idle"` (supportsActivity false).

- [ ] **Step 2: Fix `registerSession`**

```ts
            supportsActivity:
                type === "claude" ||
                type === "codex" ||
                type === "opencode" ||
                type === "gemini" ||
                type === "cursor" ||
                type === "pi" ||
                type === "kimi",
```

Run the test again. Expected: PASS.

- [ ] **Step 3: NewTaskDialog — add Pi and Kimi**

1. Availability flags after `cursorAvailable` (line ~81):

```tsx
    const piAvailable = isAgentAvailable(agents, "pi");
    const kimiAvailable = isAgentAvailable(agents, "kimi");
```

2. `handleStartWithChange` (~line 107): add guards `if (value === "pi" && !piAvailable) return;` and `if (value === "kimi" && !kimiAvailable) return;`; add `value !== "pi" &&` and `value !== "kimi" &&` to the agent-options reset condition; add `piAvailable, kimiAvailable` to the dependency array.
3. `handleSubmit` `startWith` mapping (~line 353-362): add `startWith === "pi" ||` and `startWith === "kimi" ||` to the condition.
4. `NewTaskDialogProps.onSubmit` `startWith` union (line 42, currently ends at `"pi"`): add `| "kimi"` so it reads `"claude" | "codex" | "opencode" | "gemini" | "cursor" | "pi" | "kimi"` (matching the `TaskCreationDialogHost` union from Task 6).
5. `SelectItem`s after `cursor` (~line 321):

```tsx
                                <SelectItem value="pi" disabled={!piAvailable}>
                                    Pi{!piAvailable ? " (not installed)" : ""}
                                </SelectItem>
                                <SelectItem value="kimi" disabled={!kimiAvailable}>
                                    Kimi{!kimiAvailable ? " (not installed)" : ""}
                                </SelectItem>
```

6. Agent Options collapsible gate (~line 355): add `startWith === "pi" ||` and `startWith === "kimi" ||` to the condition.

- [ ] **Step 4: ActionEditor — add Pi and Kimi**

1. In the local `normalizeAgentOptions` switch (before `default:`):

```tsx
        case "pi": {
            const opts = matchingOptions?.type === "pi" ? matchingOptions : undefined;
            return {
                type: "pi",
                model: opts?.model,
                thinking: opts?.thinking,
                tools: opts?.tools,
            };
        }
        case "kimi": {
            const opts = matchingOptions?.type === "kimi" ? matchingOptions : undefined;
            return {
                type: "kimi",
                model: opts?.model,
                permissionMode:
                    opts?.permissionMode &&
                    (KIMI_PERMISSION_MODES as readonly string[]).includes(opts.permissionMode)
                        ? opts.permissionMode
                        : undefined,
            };
        }
```

(add `KIMI_PERMISSION_MODES` to this file's `@taskflow/shared` value imports)

2. Session Type `SelectContent` (~line 235): after the Cursor item, before Shell:

```tsx
                                <SelectItem value="pi">Pi</SelectItem>
                                <SelectItem value="kimi">Kimi</SelectItem>
```

- [ ] **Step 5: InlineActionEditor — add Pi and Kimi**

Same two `SelectItem`s after Cursor, before Shell, in the session-type `SelectContent` (~line 57-63).

- [ ] **Step 6: Typecheck + full test suite, commit**

Run: `bun run typecheck && bun run lint && bun test`
Expected: all clean.

```bash
git add packages/ui/src/components/sidebar/NewTaskDialog.tsx packages/ui/src/components/flows/ActionEditor.tsx packages/ui/src/components/flows/InlineActionEditor.tsx packages/backend/src/services/tray-state-tracker.ts packages/backend/src/services/__tests__/tray-state-tracker.test.ts
git commit -m "feat: pi and kimi in new-task dialog, flow editors, and tray tracking"
```

---

### Task 10: End-to-end verification

**Files:** none (verification only).

- [ ] **Step 1: Full static + test pass**

Run: `bun run typecheck && bun run lint && bun test`
Expected: all clean. Fix anything that isn't before proceeding.

- [ ] **Step 2: Manual PTY injection check against the real kimi TUI**

Run the dev app (`bun run dev:backend` + `bun run dev:ui`; sandbox per project memory if touching real data is a concern), then:

1. Confirm Kimi appears in the agent dropdown / run menu (kimi is installed, so it must be available; if missing, check `buildShellPath()` output contains `~/.kimi-code/bin`).
2. Open Settings → Kimi: model dropdown lists K2.7 Coding / K2.7 Coding Highspeed / K3 with alias + context badges.
3. Create a task with a **multiline** description starting with Kimi (permission mode `auto`): verify the TUI opens, the full injected message (Taskflow context + `---` + prompt) lands as ONE submitted message after startup, and kimi begins responding. Verify newlines inside the prompt did not submit early (bracketed paste working).
4. In the running session, ask kimi to run `taskflow-cli task` — verify it knows the CLI from the injected context and the command works.
5. Create a plain Kimi session with no prompt: verify nothing is injected.
6. Create a flow with a Kimi action and run it on a task: verify the action prompt is injected and the flow proceeds.

If the TUI swallows the paste or submits early, tune `INITIAL_INPUT_QUIET_MS` / `INITIAL_INPUT_SUBMIT_DELAY_MS` in `pty-manager.ts` (keep the test expectations in sync) and re-verify.

- [ ] **Step 3: Codex review of the implementation**

Per user policy, run the `codex-review` skill (gpt-5.5) over the full change set (`git diff <base>..HEAD` where `<base>` is the commit before Task 1). Verify important findings independently; fix confirmed issues; re-run `bun run typecheck && bun run lint && bun test`.

- [ ] **Step 4: Final commit (if fixes were made)**

```bash
git add -A && git commit -m "fix: address kimi support review findings"
```
