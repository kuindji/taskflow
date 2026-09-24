# Built-in Actions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Execution method (chosen by the user):** gpt-6-sol implements, driven through the Codex CLI (`codex exec -m gpt-6-sol`). Claude orchestrates and reviews each task. The implementer follows each task exactly. It must not rename anything, add files, add exports, change defaults or make design decisions. When a step can't be done as written, it stops and reports why.

**Goal:** Make the four hardcoded AI helpers (task title, schedule name, commit message, commit with agent) into built-in actions. The user can edit their prompt and agent in the Actions and Flows dialog and reset them to defaults.

**Architecture:** The defaults live in `packages/shared`. User overrides are full snapshots in `builtin-actions.json`, written by `FlowStore`. A backend service merges defaults with overrides and validates them. A new headless runner runs any of the five agents one-shot. The three backend call sites run through it. The UI adds a "Built-in" filter, a `BuiltinActionEditor`, and a `headless` mode for `AgentOptionsPanel`. The commit dialog drops its agent pickers and reads the built-in instead.

**Tech Stack:** Bun, TypeScript, React 19, zustand, bun:test with happy-dom.

**Spec:** `docs/superpowers/specs/2026-09-24-built-in-actions-design.md` (commit `7056fe33`). Read it before starting.

## Global Constraints

- Use `bun`, never `npm`/`yarn`. Run tests from the repo root: `bun test <path>`.
- No `as any`. No new `eslint-disable` comments. Only export what another module imports.
- Before adding a type, check that `packages/shared/src/types/*` doesn't already have one.
- The default prompts must stay byte-for-byte identical to today's strings. Default agents: title and schedule name use `claude` + `model: "haiku"`, commit message uses `claude` with no options, and commit uses the user's default agent.
- Format only the files you touched: `bunx prettier --write <file> <file> …`. **Never** run `bun run format` (it rewrites the whole repo).
- Run UI component tests one file at a time (`mock.module` leaks across files in one bun process).
- Commit messages are conventional (`feat(scope): …`) with **no** `Co-Authored-By` or other trailers.
- Don't touch `packages/tui` or `taskflow-cli`.
- After each task, run the task's tests plus `bun run typecheck`, and fix everything before committing.

## Review Focus

1. **Placeholder-like text inside data.** A diff or description containing `{{diff}}`, `$&` or `$1` must appear in the prompt literally, never substituted again. The test is in Task 1.
2. **Older remote machine.** When the workspace's machine has no handler for `builtin-action:list`, commit-with-agent falls back to the default template and default agent. Any other lookup error, such as a timeout, is shown and starts no session, so a configured override is never silently skipped. The tests are in Task 7.
3. **Hand-edited or corrupt `builtin-actions.json`, or an override naming a removed agent.** The list shows defaults and nothing crashes. The test is in Task 3.
4. **Agent CLI that hangs** (e.g. waiting on a login prompt). The run is killed after the timeout and the caller's fallback runs. The codex temp file is removed on every path. The test is in Task 2.
5. **Saving only a prompt edit must not bake machine session defaults into the override.** The headless options panel doesn't prefill model, permission or sandbox from settings. The test is in Task 5.

---

## File Map

| File | Status | Responsibility |
|---|---|---|
| `packages/shared/src/types/builtin-action.ts` | create | Built-in action types + id list |
| `packages/shared/src/utils/builtin-actions.ts` | create | Defaults catalogue, `renderPromptTemplate`, `missingPromptVariables`, id guard |
| `packages/shared/src/utils/builtin-actions.test.ts` | create | Template + parity tests |
| `packages/shared/src/constants.ts` | modify | 3 `MSG` entries |
| `packages/shared/src/types/ws.ts` | modify | `BuiltinActionsListResponse` |
| `packages/shared/src/index.ts` | modify | re-export the two new modules |
| `packages/backend/src/services/headless-agent.ts` | create | `buildHeadlessCommand`, `runHeadlessAgent` |
| `packages/backend/tests/services/headless-agent.test.ts` | create | |
| `packages/backend/src/services/agent-accounts.ts` | modify | `headlessAgentEnv` (Task 2); delete `headlessClaudeEnv` (Task 4) |
| `packages/backend/src/services/internal-agent-skill.ts` | modify | export `escapeTomlBasicString` |
| `packages/backend/src/services/flow-store.ts` | modify | override persistence |
| `packages/backend/src/services/builtin-actions.ts` | create | merge + validate + save/reset |
| `packages/backend/src/handlers/builtin-action.ts` | create | WS handlers |
| `packages/backend/tests/services/builtin-actions.test.ts` | create | |
| `packages/backend/tests/handlers/builtin-action.test.ts` | create | |
| `packages/backend/src/services/builtin-action-runner.ts` | create | render + env + run for headless built-ins |
| `packages/backend/src/services/schedule-name.ts` | create | schedule-name generator (moved out of `index.ts`) |
| `packages/backend/src/services/title-generator.ts` | modify | use runner |
| `packages/backend/src/services/git-pr.ts`, `git-service.ts`, `handlers/git.ts` | modify | commit message via runner |
| `packages/backend/src/index.ts` | modify | wiring |
| `packages/ui/src/stores/flow-store.ts` | modify | built-in slices + actions |
| `packages/ui/src/lib/normalize-agent-options.ts` | modify | `agentOptionsSnapshot` moved here from `ActionEditor` |
| `packages/ui/src/components/workspace/AgentOptionsPanel.tsx` | modify | `headless` prop |
| `packages/ui/src/components/shared/{Claude,Codex,OpenCode,Pi,Kimi}Options.tsx` | modify | `headless` prop hides rows |
| `packages/ui/src/components/ui/confirm-delete-dialog.tsx` | modify | optional `confirmLabel` |
| `packages/ui/src/components/flows/BuiltinActionEditor.tsx` | create | editor |
| `packages/ui/src/components/flows/FlowManagementDialog.tsx` | modify | "Built-in" filter |
| `packages/ui/src/components/workspace/CommitDialog.tsx` | modify | remove pickers, use built-in |

---

### Task 1: Shared types, defaults, template helpers, MSG constants

**Files:**
- Create: `packages/shared/src/types/builtin-action.ts`
- Create: `packages/shared/src/utils/builtin-actions.ts`
- Create: `packages/shared/src/utils/builtin-actions.test.ts`
- Modify: `packages/shared/src/constants.ts` (after the `FLOW_ACTION_DELETE` line, ~159)
- Modify: `packages/shared/src/types/ws.ts` (after `FlowActionsListResponse`, ~667)
- Modify: `packages/shared/src/index.ts`

**Interfaces — Produces:**
- Types: `BuiltinActionId`, `HeadlessBuiltinActionId`, `BuiltinActionMode`, `BuiltinActionVariable`, `BuiltinActionVariableValues`, `BuiltinActionDefault`, `BuiltinActionOverride`, `BuiltinActionDefinition`, `BuiltinActionResetPayload`, `BuiltinActionsListResponse`
- Values: `BUILTIN_ACTION_IDS`, `BUILTIN_ACTION_DEFAULTS`, `isBuiltinActionId(value: unknown): value is BuiltinActionId`, `builtinActionFollowsDefaultAgent(id: BuiltinActionId): boolean`, `renderPromptTemplate(template: string, vars: Readonly<Record<string, string>>): string`, `missingPromptVariables(template: string, variables: readonly BuiltinActionVariable[]): string[]`
- `MSG.BUILTIN_ACTIONS_LIST = "builtin-action:list"`, `MSG.BUILTIN_ACTION_SAVE = "builtin-action:save"`, `MSG.BUILTIN_ACTION_RESET = "builtin-action:reset"`

- [ ] **Step 1: Write the failing test** — `packages/shared/src/utils/builtin-actions.test.ts`

```ts
import { describe, expect, it } from "bun:test";
import {
    BUILTIN_ACTION_DEFAULTS,
    builtinActionFollowsDefaultAgent,
    isBuiltinActionId,
    missingPromptVariables,
    renderPromptTemplate,
} from "./builtin-actions";

describe("renderPromptTemplate", () => {
    it("substitutes known placeholders and keeps unknown ones", () => {
        expect(renderPromptTemplate("a {{x}} b {{y}}", { x: "1" })).toBe("a 1 b {{y}}");
    });

    it("never re-scans substituted text or expands $ patterns", () => {
        const diff = "+ const s = '{{diff}} $& $1 $$';";
        expect(renderPromptTemplate("D: {{diff}}", { diff })).toBe(`D: ${diff}`);
    });

    it("ignores inherited object keys", () => {
        expect(renderPromptTemplate("{{constructor}}", {})).toBe("{{constructor}}");
    });
});

describe("missingPromptVariables", () => {
    it("lists required variables absent from the template", () => {
        const vars = [
            { name: "a", description: "" },
            { name: "b", description: "" },
        ];
        expect(missingPromptVariables("x {{a}}", vars)).toEqual(["b"]);
        expect(missingPromptVariables("{{a}}{{b}}", vars)).toEqual([]);
    });
});

describe("ids", () => {
    it("recognises built-in ids only", () => {
        expect(isBuiltinActionId("builtin:commit")).toBe(true);
        expect(isBuiltinActionId("builtin:nope")).toBe(false);
        expect(isBuiltinActionId(42)).toBe(false);
    });

    it("only the commit built-in follows the default agent", () => {
        expect(builtinActionFollowsDefaultAgent("builtin:commit")).toBe(true);
        expect(builtinActionFollowsDefaultAgent("builtin:task-title")).toBe(false);
    });
});

// Regression guard: these literals are copied verbatim from the code the
// built-ins replace. The defaults must render to exactly the same prompts.
describe("defaults reproduce the pre-built-in prompts", () => {
    it("task title", () => {
        const description = "Fix the thing";
        const before = `Generate a concise task title (3-7 words) for this task description. Output ONLY the title, nothing else. No quotes, no punctuation at the end.\n\nDescription: ${description}`;
        const def = BUILTIN_ACTION_DEFAULTS["builtin:task-title"];
        expect(renderPromptTemplate(def.prompt, { description })).toBe(before);
        expect(def.sessionType).toBe("claude");
        expect(def.agentOptions).toEqual({ type: "claude", model: "haiku" });
        expect(def.mode).toBe("headless");
    });

    it("schedule name", () => {
        const prompt = "Every morning, summarise";
        const before = `Generate a concise schedule name (3-7 words) for this scheduled task prompt. Output ONLY the name, nothing else. No quotes, no punctuation at the end.\n\nPrompt: ${prompt}`;
        const def = BUILTIN_ACTION_DEFAULTS["builtin:schedule-name"];
        expect(renderPromptTemplate(def.prompt, { prompt })).toBe(before);
        expect(def.sessionType).toBe("claude");
        expect(def.agentOptions).toEqual({ type: "claude", model: "haiku" });
    });

    it("commit message", () => {
        const diff = "diff --git a/x b/x";
        const before = [
            "Generate a concise git commit message for the following changes.",
            "Output ONLY the commit message — no explanation, no markdown, no quotes.",
            "Use conventional commit format (e.g. feat:, fix:, refactor:).",
            "",
            diff,
        ].join("\n");
        const def = BUILTIN_ACTION_DEFAULTS["builtin:commit-message"];
        expect(renderPromptTemplate(def.prompt, { diff })).toBe(before);
        expect(def.sessionType).toBe("claude");
        expect(def.agentOptions).toBeUndefined();
    });

    it("commit with agent", () => {
        const instructions = "Create commits for staged changes only. Push to remote after committing.";
        const def = BUILTIN_ACTION_DEFAULTS["builtin:commit"];
        expect(renderPromptTemplate(def.prompt, { instructions })).toBe(instructions);
        expect(def.sessionType).toBeUndefined();
        expect(def.mode).toBe("session");
    });

    it("every default declares the placeholders its template uses", () => {
        for (const def of Object.values(BUILTIN_ACTION_DEFAULTS)) {
            expect(missingPromptVariables(def.prompt, def.variables)).toEqual([]);
        }
    });
});
```

- [ ] **Step 2: Run the test and check that it fails**

Run: `bun test packages/shared/src/utils/builtin-actions.test.ts`
Expected: FAIL — `Cannot find module './builtin-actions'`.

- [ ] **Step 3: Create `packages/shared/src/types/builtin-action.ts`**

```ts
import type { AgentLaunchOptions, AgentType } from "./agent";

const BUILTIN_ACTION_IDS = [
    "builtin:task-title",
    "builtin:schedule-name",
    "builtin:commit-message",
    "builtin:commit",
] as const;

type BuiltinActionId = (typeof BUILTIN_ACTION_IDS)[number];

/** Built-ins that run one-shot and return text, as opposed to opening a session. */
type HeadlessBuiltinActionId = Exclude<BuiltinActionId, "builtin:commit">;

type BuiltinActionMode = "headless" | "session";

interface BuiltinActionVariable {
    /** Placeholder name, written as {{name}} in the prompt. */
    name: string;
    description: string;
}

/** What each built-in's prompt receives at run time, keyed by placeholder name. */
interface BuiltinActionVariableValues {
    "builtin:task-title": { description: string };
    "builtin:schedule-name": { prompt: string };
    "builtin:commit-message": { diff: string };
    "builtin:commit": { instructions: string };
}

/** Code-owned default. Never persisted. */
interface BuiltinActionDefault {
    id: BuiltinActionId;
    name: string;
    description: string;
    mode: BuiltinActionMode;
    prompt: string;
    /** Undefined means the machine's default agent (settings.general.defaultAgent). */
    sessionType?: AgentType;
    agentOptions?: AgentLaunchOptions;
    /** Every listed variable is required in the prompt. */
    variables: BuiltinActionVariable[];
}

/** The user's change, persisted as a full snapshot. Deleting it resets to the default. */
interface BuiltinActionOverride {
    id: BuiltinActionId;
    prompt: string;
    sessionType?: AgentType;
    agentOptions?: AgentLaunchOptions;
    updatedAt: string;
}

/** Effective definition: the default merged with the override, if any. */
interface BuiltinActionDefinition extends BuiltinActionDefault {
    isModified: boolean;
    updatedAt?: string;
}

interface BuiltinActionResetPayload {
    id: BuiltinActionId;
}

export type {
    BuiltinActionId,
    HeadlessBuiltinActionId,
    BuiltinActionMode,
    BuiltinActionVariable,
    BuiltinActionVariableValues,
    BuiltinActionDefault,
    BuiltinActionOverride,
    BuiltinActionDefinition,
    BuiltinActionResetPayload,
};
export { BUILTIN_ACTION_IDS };
```

- [ ] **Step 4: Create `packages/shared/src/utils/builtin-actions.ts`**

```ts
import { BUILTIN_ACTION_IDS } from "../types/builtin-action";
import type {
    BuiltinActionDefault,
    BuiltinActionId,
    BuiltinActionVariable,
} from "../types/builtin-action";

const BUILTIN_ACTION_DEFAULTS: Record<BuiltinActionId, BuiltinActionDefault> = {
    "builtin:task-title": {
        id: "builtin:task-title",
        name: "Generate task title",
        description: "Names a new task from its description when no title is given.",
        mode: "headless",
        prompt: "Generate a concise task title (3-7 words) for this task description. Output ONLY the title, nothing else. No quotes, no punctuation at the end.\n\nDescription: {{description}}",
        sessionType: "claude",
        agentOptions: { type: "claude", model: "haiku" },
        variables: [{ name: "description", description: "The task description" }],
    },
    "builtin:schedule-name": {
        id: "builtin:schedule-name",
        name: "Generate schedule name",
        description: "Names a new schedule from its prompt when no name is given.",
        mode: "headless",
        prompt: "Generate a concise schedule name (3-7 words) for this scheduled task prompt. Output ONLY the name, nothing else. No quotes, no punctuation at the end.\n\nPrompt: {{prompt}}",
        sessionType: "claude",
        agentOptions: { type: "claude", model: "haiku" },
        variables: [{ name: "prompt", description: "The schedule's prompt" }],
    },
    "builtin:commit-message": {
        id: "builtin:commit-message",
        name: "Generate commit message",
        description: "Writes the commit message when the commit dialog's message is left empty.",
        mode: "headless",
        prompt: [
            "Generate a concise git commit message for the following changes.",
            "Output ONLY the commit message — no explanation, no markdown, no quotes.",
            "Use conventional commit format (e.g. feat:, fix:, refactor:).",
            "",
            "{{diff}}",
        ].join("\n"),
        sessionType: "claude",
        variables: [{ name: "diff", description: "The diff of the changes being committed" }],
    },
    "builtin:commit": {
        id: "builtin:commit",
        name: "Commit with agent",
        description: "Starts an agent session from the commit dialog when Use agent is on.",
        mode: "session",
        prompt: "{{instructions}}",
        variables: [
            {
                name: "instructions",
                description:
                    "What to commit, the message hint, and whether to push and open a PR, from the dialog's switches",
            },
        ],
    },
};

function isBuiltinActionId(value: unknown): value is BuiltinActionId {
    return typeof value === "string" && (BUILTIN_ACTION_IDS as readonly string[]).includes(value);
}

/** Whether the built-in may leave its agent unset and follow the machine's default agent. */
function builtinActionFollowsDefaultAgent(id: BuiltinActionId): boolean {
    return BUILTIN_ACTION_DEFAULTS[id].sessionType === undefined;
}

/**
 * Replace each {{name}} with vars[name]. Unknown placeholders stay as written.
 * Substituted text is never scanned again, and `$` patterns are not expanded,
 * because the replacement is computed by a function.
 */
function renderPromptTemplate(template: string, vars: Readonly<Record<string, string>>): string {
    return template.replace(/\{\{(\w+)\}\}/g, (match: string, name: string) =>
        Object.hasOwn(vars, name) ? vars[name] : match,
    );
}

/** Names of required variables whose {{name}} does not appear in the template. */
function missingPromptVariables(
    template: string,
    variables: readonly BuiltinActionVariable[],
): string[] {
    return variables
        .filter((variable) => !template.includes(`{{${variable.name}}}`))
        .map((variable) => variable.name);
}

export {
    BUILTIN_ACTION_DEFAULTS,
    isBuiltinActionId,
    builtinActionFollowsDefaultAgent,
    renderPromptTemplate,
    missingPromptVariables,
};
```

- [ ] **Step 5: Add the MSG constants, the WS response type and the re-exports**

In `packages/shared/src/constants.ts`, directly after `FLOW_ACTION_DELETE: "flow:action-delete",` add:

```ts

    // Built-in actions
    BUILTIN_ACTIONS_LIST: "builtin-action:list",
    BUILTIN_ACTION_SAVE: "builtin-action:save",
    BUILTIN_ACTION_RESET: "builtin-action:reset",
```

In `packages/shared/src/types/ws.ts`, add a new import line directly below `import type { ActionDefinition, FlowDefinition, FlowRun } from "./flow";` (line 19):

```ts
import type { BuiltinActionDefinition } from "./builtin-action";
```

Then, after `FlowActionsListResponse`, add:

```ts
export interface BuiltinActionsListResponse {
    actions: BuiltinActionDefinition[];
}
```

In `packages/shared/src/index.ts`, after `export * from "./types/flow";` add:

```ts
export * from "./types/builtin-action";
export * from "./utils/builtin-actions";
```

- [ ] **Step 6: Run the tests and check that they pass**

Run: `bun test packages/shared/src/utils/builtin-actions.test.ts && bun run typecheck`
Expected: all tests PASS; typecheck exits 0.

- [ ] **Step 7: Commit**

```bash
bunx prettier --write packages/shared/src/types/builtin-action.ts packages/shared/src/utils/builtin-actions.ts packages/shared/src/utils/builtin-actions.test.ts packages/shared/src/constants.ts packages/shared/src/types/ws.ts packages/shared/src/index.ts
git add packages/shared
git commit -m "feat(shared): built-in action types, defaults and prompt templates"
```

---

### Task 2: Headless runner for every agent

**Files:**
- Create: `packages/backend/src/services/headless-agent.ts`
- Create: `packages/backend/tests/services/headless-agent.test.ts`
- Modify: `packages/backend/src/services/internal-agent-skill.ts:86` (export `escapeTomlBasicString`)
- Modify: `packages/backend/src/services/agent-accounts.ts` (add `headlessAgentEnv`; keep `headlessClaudeEnv` for now, since Task 4 deletes it)
- Modify: `packages/backend/tests/services/agent-accounts.test.ts` (add `headlessAgentEnv` tests)

**Interfaces — Produces:**
- `buildHeadlessCommand(type: AgentType, options: AgentLaunchOptions | undefined, prompt: string, outputFile?: string): HeadlessCommand` where `interface HeadlessCommand { command: string; args: string[]; stdin?: string }`
- `runHeadlessAgent(request: HeadlessRunRequest): Promise<string>` where `interface HeadlessRunRequest { type: AgentType; options?: AgentLaunchOptions; prompt: string; cwd?: string; env: Record<string, string | undefined>; timeoutMs?: number }`. It returns trimmed, non-empty output and throws otherwise.
- `headlessAgentEnv(type: AgentType, options: AgentLaunchOptions | undefined, settings: AppSettings, project: Project | null, env?: AgentEnv): AgentEnv`

- [ ] **Step 1: Write the failing tests** — `packages/backend/tests/services/headless-agent.test.ts`

```ts
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, writeFileSync } from "fs";
import { buildHeadlessCommand, runHeadlessAgent } from "../../src/services/headless-agent";

function closedStream(text = ""): ReadableStream<Uint8Array> {
    const bytes = new TextEncoder().encode(text);
    return new ReadableStream({
        start(controller) {
            if (bytes.length > 0) controller.enqueue(bytes);
            controller.close();
        },
    });
}

interface SpawnCall {
    cmd: string[];
    options: { cwd?: string; env?: Record<string, string | undefined> };
    stdin: string;
}

let originalSpawn: typeof Bun.spawn;
let calls: SpawnCall[];

function stubSpawn(respond: (call: SpawnCall) => { stdout?: string; exitCode?: number }): void {
    Bun.spawn = ((cmd: string[], options: SpawnCall["options"]) => {
        const call: SpawnCall = { cmd, options, stdin: "" };
        calls.push(call);
        const result = respond(call);
        return {
            stdin: {
                write(chunk: string) {
                    call.stdin += chunk;
                },
                end() {},
            },
            stdout: closedStream(result.stdout ?? ""),
            stderr: closedStream(),
            exited: Promise.resolve(result.exitCode ?? 0),
            kill() {},
        };
    }) as unknown as typeof Bun.spawn;
}

beforeEach(() => {
    originalSpawn = Bun.spawn;
    calls = [];
});

afterEach(() => {
    Bun.spawn = originalSpawn;
});

describe("buildHeadlessCommand", () => {
    it("claude: -p with model and effort, prompt on stdin, session-only options ignored", () => {
        expect(
            buildHeadlessCommand(
                "claude",
                { type: "claude", model: "haiku", effort: "low", permissionMode: "bypassPermissions" },
                "P",
            ),
        ).toEqual({ command: "claude", args: ["-p", "--model", "haiku", "--effort", "low"], stdin: "P" });
    });

    it("claude: no options means plain -p", () => {
        expect(buildHeadlessCommand("claude", undefined, "P")).toEqual({
            command: "claude",
            args: ["-p"],
            stdin: "P",
        });
    });

    it("codex: exec, read-only, ephemeral, output file, stdin prompt", () => {
        expect(
            buildHeadlessCommand(
                "codex",
                {
                    type: "codex",
                    model: "gpt-5.6-luna",
                    reasoningEffort: "low",
                    sandbox: "danger-full-access",
                    dangerouslyBypassApprovalsAndSandbox: true,
                },
                "P",
                "/tmp/out.txt",
            ),
        ).toEqual({
            command: "codex",
            args: [
                "exec",
                "--ephemeral",
                "--skip-git-repo-check",
                "-s",
                "read-only",
                "-m",
                "gpt-5.6-luna",
                "-c",
                'model_reasoning_effort="low"',
                "-o",
                "/tmp/out.txt",
                "-",
            ],
            stdin: "P",
        });
    });

    it("codex: skips the literal default model and requires an output file", () => {
        expect(
            buildHeadlessCommand("codex", { type: "codex", model: "default" }, "P", "/o").args,
        ).not.toContain("-m");
        expect(() => buildHeadlessCommand("codex", undefined, "P")).toThrow(/output file/);
    });

    it("opencode: run with model, prompt on stdin, auto-approve ignored", () => {
        expect(
            buildHeadlessCommand(
                "opencode",
                { type: "opencode", model: "openrouter/x", autoApprove: true },
                "P",
            ),
        ).toEqual({ command: "opencode", args: ["run", "-m", "openrouter/x"], stdin: "P" });
    });

    it("pi: -p --no-session, model and thinking, prompt as argument, tools ignored", () => {
        expect(
            buildHeadlessCommand(
                "pi",
                { type: "pi", model: "openai/gpt", thinking: "high", tools: "bash" },
                "P",
            ),
        ).toEqual({
            command: "pi",
            args: ["-p", "--no-session", "--model", "openai/gpt", "--thinking", "high", "P"],
        });
        expect(
            buildHeadlessCommand("pi", { type: "pi", thinking: "off" }, "P").args,
        ).not.toContain("--thinking");
    });

    it("kimi: -p prompt as argument with model, permission mode ignored", () => {
        expect(
            buildHeadlessCommand("kimi", { type: "kimi", model: "kimi-code/k3", permissionMode: "yolo" }, "P"),
        ).toEqual({ command: "kimi", args: ["-p", "P", "-m", "kimi-code/k3"] });
    });

    it("ignores options that belong to another agent", () => {
        expect(buildHeadlessCommand("claude", { type: "codex", model: "x" }, "P").args).toEqual(["-p"]);
    });
});

describe("runHeadlessAgent", () => {
    it("writes the prompt to stdin and returns trimmed stdout", async () => {
        stubSpawn(() => ({ stdout: "  Title here \n" }));
        const out = await runHeadlessAgent({
            type: "claude",
            prompt: "P",
            cwd: "/repo",
            env: { A: "1" },
        });
        expect(out).toBe("Title here");
        expect(calls[0].cmd).toEqual(["claude", "-p"]);
        expect(calls[0].stdin).toBe("P");
        expect(calls[0].options.cwd).toBe("/repo");
        expect(calls[0].options.env).toEqual({ A: "1" });
    });

    it("does not write argument-delivered prompts to stdin", async () => {
        stubSpawn(() => ({ stdout: "ok" }));
        await runHeadlessAgent({ type: "kimi", prompt: "P", env: {} });
        expect(calls[0].stdin).toBe("");
    });

    it("throws on a non-zero exit and on empty output", async () => {
        stubSpawn(() => ({ stdout: "x", exitCode: 1 }));
        await expect(runHeadlessAgent({ type: "claude", prompt: "P", env: {} })).rejects.toThrow(
            /exited with code 1/,
        );
        stubSpawn(() => ({ stdout: "   \n" }));
        await expect(runHeadlessAgent({ type: "claude", prompt: "P", env: {} })).rejects.toThrow(
            /no output/,
        );
    });

    it("codex: reads the output file, not stdout, and removes it", async () => {
        let outputFile = "";
        stubSpawn((call) => {
            outputFile = call.cmd[call.cmd.indexOf("-o") + 1];
            writeFileSync(outputFile, "Luna title\n");
            return { stdout: "progress noise" };
        });
        const out = await runHeadlessAgent({ type: "codex", prompt: "P", env: {} });
        expect(out).toBe("Luna title");
        expect(existsSync(outputFile)).toBe(false);
    });

    it("codex: removes the output file when the run fails", async () => {
        let outputFile = "";
        stubSpawn((call) => {
            outputFile = call.cmd[call.cmd.indexOf("-o") + 1];
            writeFileSync(outputFile, "partial");
            return { exitCode: 2 };
        });
        await expect(runHeadlessAgent({ type: "codex", prompt: "P", env: {} })).rejects.toThrow();
        expect(existsSync(outputFile)).toBe(false);
    });

    it("kills a run that exceeds the timeout", async () => {
        let killed = false;
        Bun.spawn = (() => {
            let resolveExit!: (code: number) => void;
            let closeStdout!: () => void;
            return {
                stdin: { write() {}, end() {} },
                stdout: new ReadableStream({
                    start(controller) {
                        closeStdout = () => controller.close();
                    },
                }),
                stderr: closedStream(),
                exited: new Promise<number>((resolve) => {
                    resolveExit = resolve;
                }),
                kill() {
                    killed = true;
                    closeStdout();
                    resolveExit(143);
                },
            };
        }) as unknown as typeof Bun.spawn;

        await expect(
            runHeadlessAgent({ type: "claude", prompt: "P", env: {}, timeoutMs: 20 }),
        ).rejects.toThrow(/timed out/);
        expect(killed).toBe(true);
    });
});
```

Append to `packages/backend/tests/services/agent-accounts.test.ts`. Add `headlessAgentEnv` to the existing import from `../../src/services/agent-accounts`, and reuse the file's existing `settingsWith` and `projectWith` helpers:

```ts
describe("headlessAgentEnv", () => {
    it("claude: strips nested-session markers and applies the action's account first", () => {
        const env = headlessAgentEnv(
            "claude",
            { type: "claude", account: "c-alt" },
            settingsWith({}),
            projectWith({ claude: "c-work" }),
            { CLAUDECODE: "1", CLAUDE_CODE_ENTRYPOINT: "cli", HOME: "/Users/me" },
        );
        expect(env.CLAUDECODE).toBeUndefined();
        expect(env.CLAUDE_CODE_ENTRYPOINT).toBeUndefined();
        expect(env.HOME).toBe("/Users/me");
        expect(env.CLAUDE_CONFIG_DIR).toBe("/homes/claude-alt");
        expect(typeof env.PATH).toBe("string");
    });

    it("claude: falls back to the project's account", () => {
        const env = headlessAgentEnv("claude", undefined, settingsWith({}), projectWith({ claude: "c-work" }), {});
        expect(env.CLAUDE_CONFIG_DIR).toBe("/homes/claude-work");
    });

    it("kimi: disables auto-update and sets no account variables", () => {
        const env = headlessAgentEnv("kimi", undefined, settingsWith({}), null, {});
        expect(env.KIMI_CODE_NO_AUTO_UPDATE).toBe("1");
        expect(env.CLAUDE_CONFIG_DIR).toBeUndefined();
        expect(env.CODEX_HOME).toBeUndefined();
    });
});
```

Add this case inside the same `describe`. `settingsWith` already has the Codex account `x-work` → `/homes/codex-work`:

```ts
    it("codex: applies the action's codex account", () => {
        const env = headlessAgentEnv(
            "codex",
            { type: "codex", account: "x-work" },
            settingsWith({}),
            null,
            {},
        );
        expect(env.CODEX_HOME).toBe("/homes/codex-work");
    });
```

- [ ] **Step 2: Run the tests and check that they fail**

Run: `bun test packages/backend/tests/services/headless-agent.test.ts packages/backend/tests/services/agent-accounts.test.ts`
Expected: FAIL — module `headless-agent` not found, and `headlessAgentEnv` is not exported.

- [ ] **Step 3: Export `escapeTomlBasicString`**

In `packages/backend/src/services/internal-agent-skill.ts`, change `function escapeTomlBasicString(` to `export function escapeTomlBasicString(`. The file already uses inline `export function`.

- [ ] **Step 4: Add `headlessAgentEnv` to `agent-accounts.ts`**

Add `AgentType` to the `import type` from `@taskflow/shared`. Below `headlessClaudeEnv`, add:

```ts
/**
 * Env for one-shot headless agent runs: no nested-session markers, full PATH,
 * and for Claude/Codex the account home resolved launch options → project → global default.
 */
function headlessAgentEnv(
    type: AgentType,
    options: AgentLaunchOptions | undefined,
    settings: AppSettings,
    project: Project | null,
    env: AgentEnv = process.env,
): AgentEnv {
    const { CLAUDECODE: _a, CLAUDE_CODE_ENTRYPOINT: _b, ...cleanEnv } = env;
    const base: AgentEnv = { ...cleanEnv, PATH: buildShellPath() };
    if (isAccountAgentType(type)) {
        const { override } = resolveAgentAccount(type, options, project, settings, env);
        return { ...base, ...accountEnv(type, override) };
    }
    if (type === "kimi") return { ...base, KIMI_CODE_NO_AUTO_UPDATE: "1" };
    return base;
}
```

Add `headlessAgentEnv` to the file's `export { … }` list.

- [ ] **Step 5: Create `packages/backend/src/services/headless-agent.ts`**

```ts
import { randomUUID } from "crypto";
import { readFile, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { CLAUDE_EFFORT_LEVELS, CODEX_REASONING_EFFORTS } from "@taskflow/shared";
import type { AgentLaunchOptions, AgentType } from "@taskflow/shared";
import { escapeTomlBasicString } from "./internal-agent-skill";

const DEFAULT_HEADLESS_TIMEOUT_MS = 120_000;

interface HeadlessCommand {
    command: string;
    args: string[];
    /** Prompt to write to stdin; undefined when the prompt travels in args. */
    stdin?: string;
}

interface HeadlessRunRequest {
    type: AgentType;
    options?: AgentLaunchOptions;
    prompt: string;
    cwd?: string;
    env: Record<string, string | undefined>;
    timeoutMs?: number;
}

/**
 * The one-shot command line for each agent. A headless run is read-only text
 * generation, so only model/reasoning options apply; permission, sandbox,
 * approval, auto-approve and tool options are ignored. Kimi rejects an empty
 * `-p`, and Pi's stdin handling is unverified, so both take the prompt as an argument.
 */
function buildHeadlessCommand(
    type: AgentType,
    options: AgentLaunchOptions | undefined,
    prompt: string,
    outputFile?: string,
): HeadlessCommand {
    switch (type) {
        case "claude": {
            const args = ["-p"];
            if (options?.type === "claude") {
                if (options.model) args.push("--model", options.model);
                if (
                    options.effort &&
                    (CLAUDE_EFFORT_LEVELS as readonly string[]).includes(options.effort)
                )
                    args.push("--effort", options.effort);
            }
            return { command: "claude", args, stdin: prompt };
        }
        case "codex": {
            if (!outputFile) throw new Error("A headless Codex run needs an output file");
            const args = ["exec", "--ephemeral", "--skip-git-repo-check", "-s", "read-only"];
            if (options?.type === "codex") {
                if (options.model && options.model !== "default") args.push("-m", options.model);
                if (
                    options.reasoningEffort &&
                    (CODEX_REASONING_EFFORTS as readonly string[]).includes(options.reasoningEffort)
                )
                    args.push(
                        "-c",
                        `model_reasoning_effort="${escapeTomlBasicString(options.reasoningEffort)}"`,
                    );
            }
            args.push("-o", outputFile, "-");
            return { command: "codex", args, stdin: prompt };
        }
        case "opencode": {
            const args = ["run"];
            if (options?.type === "opencode" && options.model) args.push("-m", options.model);
            return { command: "opencode", args, stdin: prompt };
        }
        case "pi": {
            const args = ["-p", "--no-session"];
            if (options?.type === "pi") {
                if (options.model) args.push("--model", options.model);
                if (options.thinking && options.thinking !== "off")
                    args.push("--thinking", options.thinking);
            }
            args.push(prompt);
            return { command: "pi", args };
        }
        case "kimi": {
            const args = ["-p", prompt];
            if (options?.type === "kimi" && options.model) args.push("-m", options.model);
            return { command: "kimi", args };
        }
        default:
            // Compile-time unreachable; persisted data can still smuggle removed agent types.
            throw new Error(`Unsupported agent type: ${String(type)}`);
    }
}

/** Run an agent one-shot and return its trimmed answer. Throws on failure, timeout or empty output. */
async function runHeadlessAgent(request: HeadlessRunRequest): Promise<string> {
    const outputFile =
        request.type === "codex"
            ? join(tmpdir(), `taskflow-headless-${randomUUID()}.txt`)
            : undefined;
    try {
        const { command, args, stdin } = buildHeadlessCommand(
            request.type,
            request.options,
            request.prompt,
            outputFile,
        );
        const proc = Bun.spawn([command, ...args], {
            cwd: request.cwd,
            env: request.env,
            stdin: "pipe",
            stdout: "pipe",
            stderr: "pipe",
        });
        if (stdin !== undefined) void proc.stdin.write(stdin);
        void proc.stdin.end();

        let timedOut = false;
        const timer = setTimeout(() => {
            timedOut = true;
            proc.kill();
        }, request.timeoutMs ?? DEFAULT_HEADLESS_TIMEOUT_MS);
        let stdout: string;
        let stderr: string;
        let exitCode: number;
        try {
            [stdout, stderr, exitCode] = await Promise.all([
                new Response(proc.stdout).text(),
                new Response(proc.stderr).text(),
                proc.exited,
            ]);
        } finally {
            clearTimeout(timer);
        }

        if (timedOut) throw new Error(`${command} timed out`);
        if (exitCode !== 0) {
            const detail = stderr.trim().slice(0, 500);
            throw new Error(`${command} exited with code ${exitCode}${detail ? `: ${detail}` : ""}`);
        }
        const output = (outputFile ? await readFile(outputFile, "utf-8") : stdout).trim();
        if (!output) throw new Error(`${command} returned no output`);
        return output;
    } finally {
        if (outputFile) await rm(outputFile, { force: true });
    }
}

export { buildHeadlessCommand, runHeadlessAgent };
```

`HeadlessCommand` and `HeadlessRunRequest` stay file-local (not exported), because no other module imports them.

- [ ] **Step 6: Run the tests and check that they pass**

Run: `bun test packages/backend/tests/services/headless-agent.test.ts packages/backend/tests/services/agent-accounts.test.ts packages/backend/tests/services/internal-agent-skill.test.ts && bun run typecheck`
Expected: PASS; typecheck exits 0.

- [ ] **Step 7: Commit**

```bash
bunx prettier --write packages/backend/src/services/headless-agent.ts packages/backend/tests/services/headless-agent.test.ts packages/backend/src/services/agent-accounts.ts packages/backend/tests/services/agent-accounts.test.ts packages/backend/src/services/internal-agent-skill.ts
git add packages/backend
git commit -m "feat(backend): headless one-shot runner for every agent"
```

---

### Task 3: Override storage, built-in actions service, WS handlers

**Files:**
- Modify: `packages/backend/src/services/flow-store.ts` (new section after `deleteAction`, ~line 136)
- Create: `packages/backend/src/services/builtin-actions.ts`
- Create: `packages/backend/src/handlers/builtin-action.ts`
- Modify: `packages/backend/src/index.ts` (construct + register)
- Create: `packages/backend/tests/services/builtin-actions.test.ts`
- Create: `packages/backend/tests/handlers/builtin-action.test.ts`

**Interfaces:**
- Consumes (Task 1): `BUILTIN_ACTION_IDS`, `BUILTIN_ACTION_DEFAULTS`, `isBuiltinActionId`, `builtinActionFollowsDefaultAgent`, `missingPromptVariables`, `isAgentType`, the types.
- Produces:
  - `FlowStore.getBuiltinActionOverrides(): Promise<unknown[]>`
  - `FlowStore.saveBuiltinActionOverride(override: BuiltinActionOverride): Promise<void>`
  - `FlowStore.deleteBuiltinActionOverride(id: BuiltinActionId): Promise<void>`
  - `createBuiltinActions(deps: { flowStore: FlowStore }): BuiltinActions` with `interface BuiltinActions { list(): Promise<BuiltinActionDefinition[]>; get(id: BuiltinActionId): Promise<BuiltinActionDefinition>; save(value: unknown): Promise<BuiltinActionDefinition>; reset(id: BuiltinActionId): Promise<BuiltinActionDefinition> }` (exported type)
  - `registerBuiltinActionHandlers(deps: { router: Router; builtinActions: BuiltinActions }): void`

- [ ] **Step 1: Write the failing service test** — `packages/backend/tests/services/builtin-actions.test.ts`

```ts
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { BUILTIN_ACTION_DEFAULTS } from "@taskflow/shared";
import { FlowStore } from "../../src/services/flow-store";
import { createBuiltinActions } from "../../src/services/builtin-actions";

let tempDir: string;
let flowStore: FlowStore;

beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "taskflow-builtin-test-"));
    flowStore = new FlowStore(join(tempDir, "flows"), join(tempDir, "runs"));
    await flowStore.init();
});

afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
});

const titleOverride = {
    id: "builtin:task-title",
    prompt: "Title for: {{description}}",
    sessionType: "codex",
    agentOptions: { type: "codex", model: "gpt-5.6-luna" },
    updatedAt: "2000-01-01T00:00:00.000Z",
};

describe("builtin actions", () => {
    it("lists all four defaults, unmodified, in catalogue order", async () => {
        const list = await createBuiltinActions({ flowStore }).list();
        expect(list.map((a) => a.id)).toEqual([
            "builtin:task-title",
            "builtin:schedule-name",
            "builtin:commit-message",
            "builtin:commit",
        ]);
        expect(list.every((a) => !a.isModified)).toBe(true);
        expect(list[0].prompt).toBe(BUILTIN_ACTION_DEFAULTS["builtin:task-title"].prompt);
    });

    it("saves an override, stamps updatedAt, and merges it", async () => {
        const actions = createBuiltinActions({ flowStore });
        const saved = await actions.save(titleOverride);
        expect(saved.isModified).toBe(true);
        expect(saved.sessionType).toBe("codex");
        expect(saved.agentOptions).toEqual({ type: "codex", model: "gpt-5.6-luna" });
        expect(saved.prompt).toBe("Title for: {{description}}");
        expect(saved.updatedAt).not.toBe("2000-01-01T00:00:00.000Z");
        expect(saved.name).toBe("Generate task title");
        expect((await actions.get("builtin:task-title")).isModified).toBe(true);
    });

    it("reset removes the override", async () => {
        const actions = createBuiltinActions({ flowStore });
        await actions.save(titleOverride);
        const reset = await actions.reset("builtin:task-title");
        expect(reset.isModified).toBe(false);
        expect(reset.sessionType).toBe("claude");
        expect(reset.agentOptions).toEqual({ type: "claude", model: "haiku" });
        expect(reset.updatedAt).toBeUndefined();
    });

    it("rejects invalid overrides", async () => {
        const actions = createBuiltinActions({ flowStore });
        await expect(actions.save({ ...titleOverride, id: "builtin:nope" })).rejects.toThrow(
            /Unknown built-in action/,
        );
        await expect(actions.save({ ...titleOverride, prompt: "no placeholder" })).rejects.toThrow(
            /\{\{description\}\}/,
        );
        await expect(actions.save({ ...titleOverride, prompt: "   " })).rejects.toThrow(/empty/);
        await expect(
            actions.save({ ...titleOverride, sessionType: "shell", agentOptions: undefined }),
        ).rejects.toThrow(/agent/);
        await expect(
            actions.save({ ...titleOverride, agentOptions: { type: "claude" } }),
        ).rejects.toThrow(/options/);
        await expect(
            actions.save({ ...titleOverride, sessionType: undefined, agentOptions: undefined }),
        ).rejects.toThrow(/agent/);
    });

    it("lets the commit built-in follow the default agent", async () => {
        const saved = await createBuiltinActions({ flowStore }).save({
            id: "builtin:commit",
            prompt: "Carefully: {{instructions}}",
            updatedAt: "x",
        });
        expect(saved.sessionType).toBeUndefined();
        expect(saved.isModified).toBe(true);
    });

    it("ignores corrupt files and unusable entries", async () => {
        const file = join(tempDir, "flows", "builtin-actions.json");
        await writeFile(file, "{not json");
        expect((await createBuiltinActions({ flowStore }).list()).every((a) => !a.isModified)).toBe(
            true,
        );

        await writeFile(
            file,
            JSON.stringify([
                { ...titleOverride, sessionType: "gemini", agentOptions: undefined },
                { id: "builtin:gone", prompt: "x" },
                { id: "builtin:schedule-name", prompt: "missing placeholder", sessionType: "claude" },
            ]),
        );
        const list = await createBuiltinActions({ flowStore }).list();
        expect(list.every((a) => !a.isModified)).toBe(true);
    });

    it("keeps unrelated entries when saving", async () => {
        const file = join(tempDir, "flows", "builtin-actions.json");
        await writeFile(file, JSON.stringify([{ id: "builtin:gone", prompt: "x" }]));
        await createBuiltinActions({ flowStore }).save(titleOverride);
        const stored = JSON.parse(await readFile(file, "utf-8")) as { id: string }[];
        expect(stored.map((e) => e.id)).toEqual(["builtin:gone", "builtin:task-title"]);
    });
});
```

- [ ] **Step 2: Write the failing handler test** — `packages/backend/tests/handlers/builtin-action.test.ts`

```ts
import { afterEach, beforeEach, expect, it } from "bun:test";
import { mkdtemp, rm } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { MSG } from "@taskflow/shared";
import type { BuiltinActionDefinition, BuiltinActionsListResponse } from "@taskflow/shared";
import { TestRouter } from "../test-router";
import { FlowStore } from "../../src/services/flow-store";
import { createBuiltinActions } from "../../src/services/builtin-actions";
import { registerBuiltinActionHandlers } from "../../src/handlers/builtin-action";

let tempDir: string;
let router: TestRouter;

beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "taskflow-builtin-handler-"));
    const flowStore = new FlowStore(join(tempDir, "flows"), join(tempDir, "runs"));
    await flowStore.init();
    router = new TestRouter();
    registerBuiltinActionHandlers({ router, builtinActions: createBuiltinActions({ flowStore }) });
});

afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
});

it("lists, saves and resets built-in actions", async () => {
    const listed = (await router.handle(MSG.BUILTIN_ACTIONS_LIST, {})) as BuiltinActionsListResponse;
    expect(listed.actions).toHaveLength(4);

    const saved = (await router.handle(MSG.BUILTIN_ACTION_SAVE, {
        id: "builtin:schedule-name",
        prompt: "Name: {{prompt}}",
        sessionType: "claude",
        updatedAt: "x",
    })) as BuiltinActionDefinition;
    expect(saved.isModified).toBe(true);

    const reset = (await router.handle(MSG.BUILTIN_ACTION_RESET, {
        id: "builtin:schedule-name",
    })) as BuiltinActionDefinition;
    expect(reset.isModified).toBe(false);
});

it("rejects a reset for an unknown id", async () => {
    await expect(router.handle(MSG.BUILTIN_ACTION_RESET, { id: "nope" })).rejects.toThrow(
        /Unknown built-in action/,
    );
});
```

- [ ] **Step 3: Run the tests and check that they fail**

Run: `bun test packages/backend/tests/services/builtin-actions.test.ts packages/backend/tests/handlers/builtin-action.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 4: Add override persistence to `FlowStore`**

Add `BuiltinActionId` and `BuiltinActionOverride` to the `import type` from `@taskflow/shared` at the top of `flow-store.ts`. After `deleteAction` (end of the `// --- Action Definitions ---` block), insert:

```ts
    // --- Built-in action overrides ---
    // Entries are returned unvalidated; the built-in actions service decides
    // which are usable. Unknown entries survive writes untouched.

    private get builtinActionsFile(): string {
        return join(this.flowsDir, "builtin-actions.json");
    }

    async getBuiltinActionOverrides(): Promise<unknown[]> {
        try {
            const data = await this.readJsonFile<unknown>(this.builtinActionsFile);
            return Array.isArray(data) ? data : [];
        } catch (error) {
            // A hand-broken file must not take the built-ins down; defaults apply.
            if (error instanceof SyntaxError) return [];
            throw error;
        }
    }

    async saveBuiltinActionOverride(override: BuiltinActionOverride): Promise<void> {
        await this.withMutation("definitions", async () => {
            const entries = (await this.getBuiltinActionOverrides()).filter(
                (entry) => !hasId(entry, override.id),
            );
            entries.push(override);
            await writeFile(this.builtinActionsFile, JSON.stringify(entries, null, 2));
        });
    }

    async deleteBuiltinActionOverride(id: BuiltinActionId): Promise<void> {
        await this.withMutation("definitions", async () => {
            const entries = (await this.getBuiltinActionOverrides()).filter(
                (entry) => !hasId(entry, id),
            );
            await writeFile(this.builtinActionsFile, JSON.stringify(entries, null, 2));
        });
    }
```

Add this module-level helper next to `isMissingFileError`:

```ts
function hasId(entry: unknown, id: string): boolean {
    return typeof entry === "object" && entry !== null && "id" in entry && entry.id === id;
}
```

- [ ] **Step 5: Create `packages/backend/src/services/builtin-actions.ts`**

```ts
import {
    BUILTIN_ACTION_DEFAULTS,
    BUILTIN_ACTION_IDS,
    builtinActionFollowsDefaultAgent,
    isAgentType,
    isBuiltinActionId,
    missingPromptVariables,
} from "@taskflow/shared";
import type {
    AgentLaunchOptions,
    BuiltinActionDefinition,
    BuiltinActionId,
    BuiltinActionOverride,
} from "@taskflow/shared";
import type { FlowStore } from "./flow-store";

interface BuiltinActions {
    list(): Promise<BuiltinActionDefinition[]>;
    get(id: BuiltinActionId): Promise<BuiltinActionDefinition>;
    /** Validates `value` as an override, stamps updatedAt, persists it. */
    save(value: unknown): Promise<BuiltinActionDefinition>;
    reset(id: BuiltinActionId): Promise<BuiltinActionDefinition>;
}

interface BuiltinActionsDeps {
    flowStore: FlowStore;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null;
}

/** An override in canonical shape, or an error message saying why it is unusable. */
function parseOverride(value: unknown): BuiltinActionOverride | string {
    if (!isRecord(value)) return "A built-in action override must be an object";
    const { id, prompt, sessionType, agentOptions, updatedAt } = value;
    if (!isBuiltinActionId(id)) return `Unknown built-in action "${String(id)}"`;
    if (typeof prompt !== "string" || prompt.trim() === "") return "The prompt must not be empty";
    const missing = missingPromptVariables(prompt, BUILTIN_ACTION_DEFAULTS[id].variables);
    if (missing.length > 0) {
        return `The prompt must include ${missing.map((name) => `{{${name}}}`).join(", ")}`;
    }
    if (sessionType === undefined) {
        if (!builtinActionFollowsDefaultAgent(id)) return "Choose an agent for this built-in action";
        if (agentOptions !== undefined) return "Agent options need an agent";
        return { id, prompt, updatedAt: typeof updatedAt === "string" ? updatedAt : "" };
    }
    if (!isAgentType(sessionType)) return `Unsupported agent "${String(sessionType)}"`;
    if (agentOptions !== undefined && (!isRecord(agentOptions) || agentOptions.type !== sessionType)) {
        return `Agent options must be for ${sessionType}`;
    }
    return {
        id,
        prompt,
        sessionType,
        // Checked above: an object whose type matches sessionType.
        agentOptions: agentOptions as AgentLaunchOptions | undefined,
        updatedAt: typeof updatedAt === "string" ? updatedAt : "",
    };
}

function merge(id: BuiltinActionId, override: BuiltinActionOverride | undefined): BuiltinActionDefinition {
    const def = BUILTIN_ACTION_DEFAULTS[id];
    if (!override) return { ...def, isModified: false };
    return {
        ...def,
        prompt: override.prompt,
        sessionType: override.sessionType,
        agentOptions: override.agentOptions,
        isModified: true,
        updatedAt: override.updatedAt,
    };
}

function createBuiltinActions({ flowStore }: BuiltinActionsDeps): BuiltinActions {
    async function readOverrides(): Promise<Map<BuiltinActionId, BuiltinActionOverride>> {
        const overrides = new Map<BuiltinActionId, BuiltinActionOverride>();
        for (const entry of await flowStore.getBuiltinActionOverrides()) {
            const parsed = parseOverride(entry);
            if (typeof parsed !== "string") overrides.set(parsed.id, parsed);
        }
        return overrides;
    }

    async function get(id: BuiltinActionId): Promise<BuiltinActionDefinition> {
        return merge(id, (await readOverrides()).get(id));
    }

    return {
        async list() {
            const overrides = await readOverrides();
            return BUILTIN_ACTION_IDS.map((id) => merge(id, overrides.get(id)));
        },
        get,
        async save(value) {
            const parsed = parseOverride(value);
            if (typeof parsed === "string") throw new Error(parsed);
            const override: BuiltinActionOverride = { ...parsed, updatedAt: new Date().toISOString() };
            await flowStore.saveBuiltinActionOverride(override);
            return merge(override.id, override);
        },
        async reset(id) {
            await flowStore.deleteBuiltinActionOverride(id);
            return merge(id, undefined);
        },
    };
}

export { createBuiltinActions };
export type { BuiltinActions };
```

**The `as AgentLaunchOptions | undefined` cast:** `isRecord` narrows `agentOptions` to `Record<string, unknown>`, and TS has no guard for the union. This is the only cast allowed. Leave the explaining comment above it. Don't use `normalizeClaudeLaunchOptions` here: it covers only Claude.

- [ ] **Step 6: Create `packages/backend/src/handlers/builtin-action.ts`**

```ts
import { MSG, isBuiltinActionId } from "@taskflow/shared";
import type { Router } from "../ws/router";
import type { BuiltinActions } from "../services/builtin-actions";

interface BuiltinActionHandlerDeps {
    router: Router;
    builtinActions: BuiltinActions;
}

function registerBuiltinActionHandlers({ router, builtinActions }: BuiltinActionHandlerDeps): void {
    router.register(MSG.BUILTIN_ACTIONS_LIST, async () => ({
        actions: await builtinActions.list(),
    }));

    // The payload is validated inside save(); it is unknown until then.
    router.register(MSG.BUILTIN_ACTION_SAVE, async (payload) => builtinActions.save(payload));

    router.register(MSG.BUILTIN_ACTION_RESET, async (payload) => {
        const id = typeof payload === "object" && payload !== null && "id" in payload ? payload.id : undefined;
        if (!isBuiltinActionId(id)) throw new Error(`Unknown built-in action "${String(id)}"`);
        return builtinActions.reset(id);
    });
}

export { registerBuiltinActionHandlers };
```

- [ ] **Step 7: Wire into `packages/backend/src/index.ts`**

Add these imports next to the other service/handler imports:

```ts
import { createBuiltinActions } from "./services/builtin-actions";
import { registerBuiltinActionHandlers } from "./handlers/builtin-action";
```

Right after `const settingsStore = new SettingsStore(config.settingsFile);` (~line 100), add:

```ts
        const builtinActions = createBuiltinActions({ flowStore });
```

Right after `registerFlowHandlers({ router, flowStore, flowRunner });` (~line 353), add:

```ts
        registerBuiltinActionHandlers({ router, builtinActions });
```

- [ ] **Step 8: Run the tests and check that they pass**

Run: `bun test packages/backend/tests/services/builtin-actions.test.ts packages/backend/tests/handlers/builtin-action.test.ts packages/backend/tests/index.test.ts && bun run typecheck`
Expected: PASS; typecheck exits 0.

- [ ] **Step 9: Commit**

```bash
bunx prettier --write packages/backend/src/services/flow-store.ts packages/backend/src/services/builtin-actions.ts packages/backend/src/handlers/builtin-action.ts packages/backend/src/index.ts packages/backend/tests/services/builtin-actions.test.ts packages/backend/tests/handlers/builtin-action.test.ts
git add packages/backend
git commit -m "feat(backend): store, validate and serve built-in action overrides"
```

---

### Task 4: Run the three headless built-ins through the runner

**Files:**
- Create: `packages/backend/src/services/builtin-action-runner.ts`
- Create: `packages/backend/src/services/schedule-name.ts`
- Create: `packages/backend/tests/services/builtin-action-runner.test.ts`
- Create: `packages/backend/tests/services/schedule-name.test.ts`
- Create: `packages/backend/tests/services/git-pr.test.ts`
- Modify: `packages/backend/src/services/title-generator.ts` (whole file)
- Modify: `packages/backend/src/services/git-pr.ts:72-108`
- Modify: `packages/backend/src/services/git-service.ts:493-499`
- Modify: `packages/backend/src/handlers/git.ts` (deps, imports, `GIT_GENERATE_COMMIT_MSG` handler ~line 188)
- Modify: `packages/backend/src/index.ts` (runner, title generator deps, git handler deps, schedule name)
- Modify: `packages/backend/src/services/agent-accounts.ts` (delete `headlessClaudeEnv`)
- Modify: `packages/backend/tests/services/title-generator.test.ts`
- Modify: `packages/backend/tests/handlers/git.test.ts`
- Modify: `packages/backend/tests/services/agent-accounts.test.ts` (remove the `headlessClaudeEnv` describe; the `headlessAgentEnv` tests from Task 2 replace it)

**Interfaces:**
- Consumes: `BuiltinActions` (Task 3), `runHeadlessAgent` and `headlessAgentEnv` (Task 2), `renderPromptTemplate` and `BuiltinActionVariableValues` / `HeadlessBuiltinActionId` (Task 1).
- Produces:
  - `createBuiltinActionRunner(deps: { builtinActions: Pick<BuiltinActions, "get">; settingsStore: SettingsStore }): BuiltinActionRunner`
  - `interface BuiltinActionRunner { runHeadless<K extends HeadlessBuiltinActionId>(id: K, vars: BuiltinActionVariableValues[K], context: BuiltinRunContext): Promise<string> }`
  - `interface BuiltinRunContext { cwd?: string; project: Project | null }`
  - `createScheduleNameGenerator(deps: { builtinActionRunner: BuiltinActionRunner }): (prompt: string) => Promise<string>`
  - `GitService.generateCommitMessage(repoPath: string, includeUnstaged: boolean, generate: (diff: string) => Promise<string>): Promise<string>`

- [ ] **Step 1: Write the failing runner test** — `packages/backend/tests/services/builtin-action-runner.test.ts`

```ts
import { afterEach, beforeEach, expect, it } from "bun:test";
import { mkdtemp, rm } from "fs/promises";
import { writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { BUILTIN_ACTION_DEFAULTS } from "@taskflow/shared";
import type { BuiltinActionDefinition, BuiltinActionId, Project } from "@taskflow/shared";
import { SettingsStore } from "../../src/services/settings-store";
import { createBuiltinActionRunner } from "../../src/services/builtin-action-runner";

function closedStream(text = ""): ReadableStream<Uint8Array> {
    const bytes = new TextEncoder().encode(text);
    return new ReadableStream({
        start(controller) {
            if (bytes.length > 0) controller.enqueue(bytes);
            controller.close();
        },
    });
}

interface Call {
    cmd: string[];
    options: { cwd?: string; env?: Record<string, string | undefined> };
    stdin: string;
}

let tempDir: string;
let settingsStore: SettingsStore;
let originalSpawn: typeof Bun.spawn;
let calls: Call[];

beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "taskflow-runner-test-"));
    settingsStore = new SettingsStore(join(tempDir, "settings.json"));
    originalSpawn = Bun.spawn;
    calls = [];
    Bun.spawn = ((cmd: string[], options: Call["options"]) => {
        const call: Call = { cmd, options, stdin: "" };
        calls.push(call);
        const o = cmd.indexOf("-o");
        if (o >= 0) writeFileSync(cmd[o + 1], "Codex answer");
        return {
            stdin: {
                write(chunk: string) {
                    call.stdin += chunk;
                },
                end() {},
            },
            stdout: closedStream("Claude answer\n"),
            stderr: closedStream(),
            exited: Promise.resolve(0),
            kill() {},
        };
    }) as unknown as typeof Bun.spawn;
});

afterEach(async () => {
    Bun.spawn = originalSpawn;
    await rm(tempDir, { recursive: true, force: true });
});

function actionsReturning(def: BuiltinActionDefinition) {
    return { get: async (_id: BuiltinActionId) => def };
}

const project = { id: "p", agentAccounts: { claude: "c-work" } } as unknown as Project;

it("runs the default title built-in exactly as before: claude -p --model haiku", async () => {
    await settingsStore.update({
        claude: { accounts: [{ id: "c-work", name: "work", homeDir: "/homes/claude-work" }] },
    });
    const runner = createBuiltinActionRunner({
        builtinActions: actionsReturning({
            ...BUILTIN_ACTION_DEFAULTS["builtin:task-title"],
            isModified: false,
        }),
        settingsStore,
    });

    const out = await runner.runHeadless("builtin:task-title", { description: "Fix login" }, { project });

    expect(out).toBe("Claude answer");
    expect(calls[0].cmd).toEqual(["claude", "-p", "--model", "haiku"]);
    expect(calls[0].stdin).toBe(
        "Generate a concise task title (3-7 words) for this task description. Output ONLY the title, nothing else. No quotes, no punctuation at the end.\n\nDescription: Fix login",
    );
    expect(calls[0].options.env?.CLAUDE_CONFIG_DIR).toBe("/homes/claude-work");
});

it("runs an overridden built-in on Codex with its prompt, model and cwd", async () => {
    const runner = createBuiltinActionRunner({
        builtinActions: actionsReturning({
            ...BUILTIN_ACTION_DEFAULTS["builtin:commit-message"],
            prompt: "Msg for {{diff}}",
            sessionType: "codex",
            agentOptions: { type: "codex", model: "gpt-5.6-luna" },
            isModified: true,
        }),
        settingsStore,
    });

    const out = await runner.runHeadless("builtin:commit-message", { diff: "D" }, { cwd: "/repo", project: null });

    expect(out).toBe("Codex answer");
    expect(calls[0].cmd[0]).toBe("codex");
    expect(calls[0].cmd).toContain("gpt-5.6-luna");
    expect(calls[0].stdin).toBe("Msg for D");
    expect(calls[0].options.cwd).toBe("/repo");
});

it("refuses a headless run for a built-in without an agent", async () => {
    const runner = createBuiltinActionRunner({
        builtinActions: actionsReturning({
            ...BUILTIN_ACTION_DEFAULTS["builtin:task-title"],
            sessionType: undefined,
            isModified: true,
        }),
        settingsStore,
    });
    await expect(
        runner.runHeadless("builtin:task-title", { description: "d" }, { project: null }),
    ).rejects.toThrow(/no agent/);
    expect(calls).toHaveLength(0);
});
```

- [ ] **Step 2: Write the failing schedule-name and git-pr tests**

`packages/backend/tests/services/schedule-name.test.ts`:

```ts
import { expect, it } from "bun:test";
import { createScheduleNameGenerator } from "../../src/services/schedule-name";

it("uses the built-in's answer with surrounding quotes stripped", async () => {
    const seen: unknown[] = [];
    const generate = createScheduleNameGenerator({
        builtinActionRunner: {
            runHeadless: async (id, vars, context) => {
                seen.push({ id, vars, context });
                return '"Morning summary"';
            },
        },
    });
    expect(await generate("Every morning, summarise")).toBe("Morning summary");
    expect(seen).toEqual([
        {
            id: "builtin:schedule-name",
            vars: { prompt: "Every morning, summarise" },
            context: { project: null },
        },
    ]);
});

it("falls back to the truncated prompt when the run fails", async () => {
    const generate = createScheduleNameGenerator({
        builtinActionRunner: {
            runHeadless: async () => {
                throw new Error("boom");
            },
        },
    });
    expect(await generate("x".repeat(80))).toBe("x".repeat(50));
    expect(await generate("   ")).toBe("Unnamed schedule");
});
```

`packages/backend/tests/services/git-pr.test.ts`:

```ts
import { expect, it } from "bun:test";
import type { GitService } from "../../src/services/git-service";
import { generateCommitMessage } from "../../src/services/git-pr";

function fakeGit(files: { diff: string; staged: boolean }[]) {
    return { diff: async () => ({ files }) } as unknown as GitService;
}

it("passes staged-only diffs to the generator when unstaged are excluded", async () => {
    const seen: string[] = [];
    const message = await generateCommitMessage(
        fakeGit([
            { diff: "STAGED", staged: true },
            { diff: "UNSTAGED", staged: false },
        ]),
        "/repo",
        false,
        async (diff) => {
            seen.push(diff);
            return "feat: x";
        },
    );
    expect(message).toBe("feat: x");
    expect(seen).toEqual(["STAGED"]);
});

it("reports no changes without running the generator", async () => {
    let ran = false;
    await expect(
        generateCommitMessage(fakeGit([]), "/repo", true, async () => {
            ran = true;
            return "x";
        }),
    ).rejects.toThrow("No changes to commit");
    expect(ran).toBe(false);
});

it("maps generator failures to the existing error", async () => {
    await expect(
        generateCommitMessage(fakeGit([{ diff: "D", staged: true }]), "/repo", true, async () => {
            throw new Error("codex exited with code 1");
        }),
    ).rejects.toThrow("Failed to generate commit message");
});
```

- [ ] **Step 3: Run the tests and check that they fail**

Run: `bun test packages/backend/tests/services/builtin-action-runner.test.ts packages/backend/tests/services/schedule-name.test.ts packages/backend/tests/services/git-pr.test.ts`
Expected: FAIL. The runner and schedule-name modules are not found. The git-pr test fails because the 4th argument is not a function (current signature takes `env`).

- [ ] **Step 4: Create `packages/backend/src/services/builtin-action-runner.ts`**

```ts
import { renderPromptTemplate } from "@taskflow/shared";
import type {
    BuiltinActionVariableValues,
    HeadlessBuiltinActionId,
    Project,
} from "@taskflow/shared";
import type { BuiltinActions } from "./builtin-actions";
import type { SettingsStore } from "./settings-store";
import { headlessAgentEnv } from "./agent-accounts";
import { runHeadlessAgent } from "./headless-agent";

interface BuiltinRunContext {
    cwd?: string;
    /** The project the run belongs to, for its account override; null when none. */
    project: Project | null;
}

interface BuiltinActionRunner {
    runHeadless<K extends HeadlessBuiltinActionId>(
        id: K,
        vars: BuiltinActionVariableValues[K],
        context: BuiltinRunContext,
    ): Promise<string>;
}

interface BuiltinActionRunnerDeps {
    builtinActions: Pick<BuiltinActions, "get">;
    settingsStore: SettingsStore;
}

function createBuiltinActionRunner({
    builtinActions,
    settingsStore,
}: BuiltinActionRunnerDeps): BuiltinActionRunner {
    return {
        async runHeadless(id, vars, context) {
            try {
                const action = await builtinActions.get(id);
                // Saving validates that headless built-ins always name an agent.
                if (!action.sessionType) throw new Error(`Built-in action ${id} has no agent`);
                const env = headlessAgentEnv(
                    action.sessionType,
                    action.agentOptions,
                    await settingsStore.get(),
                    context.project,
                );
                return await runHeadlessAgent({
                    type: action.sessionType,
                    options: action.agentOptions,
                    prompt: renderPromptTemplate(action.prompt, vars),
                    cwd: context.cwd,
                    env,
                });
            } catch (error) {
                // Callers fall back silently; leave a trace for "why is my title wrong".
                console.warn(
                    `Built-in action ${id} failed: ${error instanceof Error ? error.message : String(error)}`,
                );
                throw error;
            }
        },
    };
}

export { createBuiltinActionRunner };
export type { BuiltinActionRunner };
```

If `renderPromptTemplate(action.prompt, vars)` fails to typecheck because `BuiltinActionVariableValues[K]` isn't assignable to `Readonly<Record<string, string>>`, **stop and report**. Don't cast.

- [ ] **Step 5: Create `packages/backend/src/services/schedule-name.ts`**

```ts
import type { BuiltinActionRunner } from "./builtin-action-runner";

interface ScheduleNameGeneratorDeps {
    builtinActionRunner: BuiltinActionRunner;
}

function createScheduleNameGenerator({ builtinActionRunner }: ScheduleNameGeneratorDeps) {
    return async (prompt: string): Promise<string> => {
        try {
            const output = await builtinActionRunner.runHeadless(
                "builtin:schedule-name",
                { prompt },
                { project: null },
            );
            const name = output.replace(/^["']|["']$/g, "");
            if (name) return name;
        } catch {
            // Fall through to fallback
        }
        return prompt.slice(0, 50).trim() || "Unnamed schedule";
    };
}

export { createScheduleNameGenerator };
```

- [ ] **Step 6: Change commit-message generation to take a generator**

In `packages/backend/src/services/git-pr.ts`, replace the whole `generateCommitMessage` function (lines 72-108) with:

```ts
async function generateCommitMessage(
    gitService: GitService,
    repoPath: string,
    includeUnstaged: boolean,
    generate: (diff: string) => Promise<string>,
): Promise<string> {
    const diffResult = await gitService.diff(repoPath);
    const files = includeUnstaged ? diffResult.files : diffResult.files.filter((f) => f.staged);
    const diffText = files.map((f) => f.diff).join("\n");
    if (!diffText.trim()) {
        throw new Error("No changes to commit");
    }
    try {
        return await generate(diffText);
    } catch {
        throw new Error("Failed to generate commit message");
    }
}
```

In `packages/backend/src/services/git-service.ts`, replace the `generateCommitMessage` method (lines 493-499) with:

```ts
    async generateCommitMessage(
        repoPath: string,
        includeUnstaged: boolean,
        generate: (diff: string) => Promise<string>,
    ): Promise<string> {
        return generateCommitMessageImpl(this, repoPath, includeUnstaged, generate);
    }
```

In `packages/backend/src/handlers/git.ts`:
- Delete `import { headlessClaudeEnv } from "../services/agent-accounts";`, and delete `import type { SettingsStore } from "../services/settings-store";` if nothing else uses it.
- Add `import type { BuiltinActionRunner } from "../services/builtin-action-runner";`.
- In `GitHandlerDeps`, replace `settingsStore: SettingsStore;` with `builtinActionRunner: BuiltinActionRunner;`, and update the destructuring on line 56 to match.
- Replace the `GIT_GENERATE_COMMIT_MSG` handler body with:

```ts
    router.register(MSG.GIT_GENERATE_COMMIT_MSG, async (payload) => {
        const { path, includeUnstaged } = payload as GitGenerateCommitMsgPayload;
        const repoPath = await assertWorkspaceRepo(taskStore, path);
        const project = await findProjectForPath(taskStore, repoPath);
        const message = await git.generateCommitMessage(repoPath, includeUnstaged ?? true, (diff) =>
            builtinActionRunner.runHeadless(
                "builtin:commit-message",
                { diff },
                { cwd: repoPath, project },
            ),
        );
        return { message };
    });
```

- [ ] **Step 7: Rewrite `packages/backend/src/services/title-generator.ts`**

```ts
import type { TaskStore } from "./task-store";
import type { WsEvent } from "@taskflow/shared";
import { MSG } from "@taskflow/shared";
import type { BuiltinActionRunner } from "./builtin-action-runner";
import { filterTaskSessions } from "./instance-filter";
import { config } from "../config";

interface TitleGeneratorDeps {
    taskStore: TaskStore;
    broadcast: (event: WsEvent) => void;
    builtinActionRunner: BuiltinActionRunner;
    createWorktree?: (taskId: string, nameSource: string, initCommand?: string) => Promise<void>;
}

export function createTitleGenerator(deps: TitleGeneratorDeps) {
    const { taskStore, broadcast, builtinActionRunner, createWorktree } = deps;

    async function generate(
        taskId: string,
        description: string,
        initCommand?: string,
    ): Promise<void> {
        try {
            const task = await taskStore.getTask(taskId);
            const project = task ? await taskStore.getProject(task.projectId) : null;

            let output: string;
            try {
                output = await builtinActionRunner.runHeadless(
                    "builtin:task-title",
                    { description },
                    { project },
                );
            } catch {
                // Title generation failed — still create worktree using description
                await createWorktree?.(taskId, description, initCommand);
                return;
            }

            const title = output.replace(/^["']|["']$/g, "");
            if (!title) {
                await createWorktree?.(taskId, description, initCommand);
                return;
            }

            const updated = await taskStore.updateTask(taskId, { title });
            broadcast({
                type: MSG.TASK_UPDATED,
                payload: filterTaskSessions(updated, config.instanceId),
            });

            await createWorktree?.(taskId, title, initCommand);
        } catch {
            // Title generation failed — still try to create worktree
            await createWorktree?.(taskId, description, initCommand).catch(() => {});
        }
    }

    return { generate };
}
```

- [ ] **Step 8: Wire `index.ts` and delete `headlessClaudeEnv`**

In `packages/backend/src/index.ts`:
- Delete `import { headlessClaudeEnv } from "./services/agent-accounts";`.
- Add `import { createBuiltinActionRunner } from "./services/builtin-action-runner";` and `import { createScheduleNameGenerator } from "./services/schedule-name";`.
- Directly after the `const builtinActions = createBuiltinActions({ flowStore });` line from Task 3, add:

```ts
        const builtinActionRunner = createBuiltinActionRunner({ builtinActions, settingsStore });
```

- In `createTitleGenerator({ … })` (~line 209), replace `settingsStore,` with `builtinActionRunner,`.
- In `registerGitHandlers({ … })` (~line 331), replace `settingsStore,` with `builtinActionRunner,`.
- Replace the whole `const generateScheduleName = async (prompt: string): Promise<string> => { … };` block (~lines 358-378) with:

```ts
        const generateScheduleName = createScheduleNameGenerator({ builtinActionRunner });
```

In `packages/backend/src/services/agent-accounts.ts`, delete the `headlessClaudeEnv` function and its entry in the `export { … }` list. Then run `grep -rn headlessClaudeEnv packages/` and expect no matches in `src`.

- [ ] **Step 9: Update the existing tests**

`packages/backend/tests/services/agent-accounts.test.ts`: delete the `describe("headlessClaudeEnv", …)` block and the `headlessClaudeEnv` import. The Task 2 `headlessAgentEnv` tests cover the same behaviour.

`packages/backend/tests/services/title-generator.test.ts`:
- Remove the `SettingsStore` import, the `settingsStore` variable and its setup, `originalSpawn`/`Bun.spawn` handling, and `makeSpawnResult`.
- Add this fake-runner helper:

```ts
import type { BuiltinActionRunner } from "../../src/services/builtin-action-runner";

function runnerReturning(result: string | Error, seen: unknown[] = []): BuiltinActionRunner {
    return {
        runHeadless: async (id, vars, context) => {
            seen.push({ id, vars, context });
            if (result instanceof Error) throw result;
            return result;
        },
    };
}
```

- In each test, drop the `Bun.spawn = …` line and pass `builtinActionRunner: runnerReturning("Fix flaky worktree detection")` (or the test's title) instead of `settingsStore`. The failure test uses `runnerReturning(new Error("exit 1"))`.
- Replace the test `"runs title generation under the task project's Claude account"` with:

```ts
    it("asks the title built-in with the description and the task's project", async () => {
        const project = await store.addProject({ name: "project", path: projectPath });
        const task = await store.createTask({
            projectId: project.id,
            title: "",
            description: "d",
            worktree: { enabled: false, path: null, branch: null, pr: null },
        });
        const seen: unknown[] = [];

        const generator = createTitleGenerator({
            taskStore: store,
            broadcast: () => {},
            builtinActionRunner: runnerReturning("Title", seen),
        });
        await generator.generate(task.id, "d");

        expect(seen).toEqual([
            {
                id: "builtin:task-title",
                vars: { description: "d" },
                context: { project: await store.getProject(project.id) },
            },
        ]);
    });
```

- Add a quote-stripping case:

```ts
    it("strips surrounding quotes from the generated title", async () => {
        const project = await store.addProject({ name: "project", path: projectPath });
        const task = await store.createTask({ projectId: project.id, title: "", description: "d" });
        const generator = createTitleGenerator({
            taskStore: store,
            broadcast: () => {},
            builtinActionRunner: runnerReturning('"Quoted title"'),
        });
        await generator.generate(task.id, "d");
        expect((await store.getTask(task.id))?.title).toBe("Quoted title");
    });
```

`packages/backend/tests/handlers/git.test.ts`:
- In `FakeGitService`, replace `commitMessageCalls` and `generateCommitMessage` with:

```ts
    commitMessageCalls: Array<{ repoPath: string; generated: string }> = [];

    async generateCommitMessage(
        repoPath: string,
        _includeUnstaged: boolean,
        generate: (diff: string) => Promise<string>,
    ) {
        const generated = await generate("DIFF");
        this.commitMessageCalls.push({ repoPath, generated });
        return generated;
    }
```

- Replace `settingsStore` in the `beforeEach` setup with a recording fake runner. Declare `let runnerCalls: unknown[];` next to the other `let`s, and in `beforeEach` set `runnerCalls = [];`, then:

```ts
        registerGitHandlers({
            router,
            git: git as unknown as GitService,
            taskStore: store,
            broadcast: () => {},
            builtinActionRunner: {
                runHeadless: async (id, vars, context) => {
                    runnerCalls.push({ id, vars, context });
                    return "feat: generated";
                },
            },
        });
```

  Remove the `SettingsStore` import and the `settingsStore` variable if nothing else uses them.

- Replace the test `"generates commit messages under the project's Claude account"` with:

```ts
    it("generates commit messages through the built-in, in the repo, for its project", async () => {
        const result = (await router.handle(MSG.GIT_GENERATE_COMMIT_MSG, {
            path: worktreePath,
        })) as { message: string };

        expect(result.message).toBe("feat: generated");
        expect(runnerCalls).toEqual([
            {
                id: "builtin:commit-message",
                vars: { diff: "DIFF" },
                context: { cwd: worktreePath, project: await store.getProject(projectId) },
            },
        ]);
    });
```

If `assertWorkspaceRepo` resolves `worktreePath` to a different canonical path, use that value as `cwd` in the expectation. Check with a failing run first; don't guess.

- [ ] **Step 10: Run the backend tests and check that they pass**

Run: `bun test packages/backend && bun run typecheck`
Expected: all backend tests PASS; typecheck exits 0.

- [ ] **Step 11: Commit**

```bash
bunx prettier --write packages/backend/src/services/builtin-action-runner.ts packages/backend/src/services/schedule-name.ts packages/backend/src/services/title-generator.ts packages/backend/src/services/git-pr.ts packages/backend/src/services/git-service.ts packages/backend/src/handlers/git.ts packages/backend/src/index.ts packages/backend/src/services/agent-accounts.ts packages/backend/tests/services/builtin-action-runner.test.ts packages/backend/tests/services/schedule-name.test.ts packages/backend/tests/services/git-pr.test.ts packages/backend/tests/services/title-generator.test.ts packages/backend/tests/handlers/git.test.ts packages/backend/tests/services/agent-accounts.test.ts
git add packages/backend
git commit -m "feat(backend): run title, schedule-name and commit-message helpers as built-in actions"
```

---

### Task 5: UI plumbing — flow store, snapshot helper, headless options panel

**Files:**
- Modify: `packages/ui/src/stores/flow-store.ts`
- Modify: `packages/ui/src/lib/normalize-agent-options.ts`
- Modify: `packages/ui/src/components/flows/ActionEditor.tsx:36-43,116,129` (use the moved helper)
- Modify: `packages/ui/src/components/workspace/AgentOptionsPanel.tsx`
- Modify: `packages/ui/src/components/shared/ClaudeOptions.tsx`, `CodexOptions.tsx`, `OpenCodeOptions.tsx`, `PiOptions.tsx`, `KimiOptions.tsx`
- Modify: `packages/ui/src/components/ui/confirm-delete-dialog.tsx`
- Modify: `packages/ui/src/components/workspace/AgentOptionsPanel.test.tsx`
- Create: `packages/ui/src/components/shared/ClaudeOptions.headless.test.tsx`

**Interfaces — Produces:**
- `useFlowStore` state `builtinActions: Scoped<BuiltinActionDefinition>[]`, plus `fetchBuiltinActions(backendId: string): Promise<void>`, `saveBuiltinAction(backendId: string, override: BuiltinActionOverride): Promise<void>` and `resetBuiltinAction(backendId: string, id: BuiltinActionId): Promise<void>`
- `agentOptionsSnapshot(sessionType: SessionType, options: AgentLaunchOptions | undefined): AgentLaunchOptions | undefined`, exported from `@/lib/normalize-agent-options`
- `AgentOptionsPanel` prop `headless?: boolean`. Each `*Options` component gets prop `headless?: boolean`.
- `ConfirmDeleteDialog` prop `confirmLabel?: string` (default `"Delete"`)

- [ ] **Step 1: Write the failing panel tests**

In `packages/ui/src/components/workspace/AgentOptionsPanel.test.tsx`:
- Extend `MockAgentSettings` with optional session defaults:

```ts
interface MockAgentSettings {
    accounts: AgentAccount[];
    defaultModel?: string;
    permissionMode?: string;
    sandbox?: string;
}
```

- Add a second mount helper below `mount`:

```ts
function mountWith(agentType: AgentType, props: { headless?: boolean; value?: AgentLaunchOptions }) {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
        root?.render(
            <AgentOptionsPanel
                agentType={agentType}
                emitOnMount
                headless={props.headless}
                value={props.value}
                onChange={(options) => emitted.push(options)}
            />,
        );
    });
}
```

- Append these tests:

```ts
test("session mode prefills Claude from the machine's session defaults", () => {
    settings.claude.defaultModel = "opus";
    settings.claude.permissionMode = "bypassPermissions";
    mountWith("claude", {});
    const options = lastEmitted();
    if (options.type !== "claude") throw new Error("expected claude options");
    expect(options.model).toBe("opus");
    expect(options.permissionMode).toBe("bypassPermissions");
});

test("headless mode ignores session defaults and omits session-only fields", () => {
    settings.claude.defaultModel = "opus";
    settings.claude.permissionMode = "bypassPermissions";
    mountWith("claude", { headless: true });
    const options = lastEmitted();
    if (options.type !== "claude") throw new Error("expected claude options");
    expect(options.model).toBeUndefined();
    expect(options.permissionMode).toBeUndefined();
});

test("headless mode keeps the saved model and account", () => {
    settings.claude.permissionMode = "bypassPermissions";
    mountWith("claude", {
        headless: true,
        value: { type: "claude", model: "haiku", account: "acc-1", permissionMode: "plan" },
    });
    const options = lastEmitted();
    if (options.type !== "claude") throw new Error("expected claude options");
    expect(options.model).toBe("haiku");
    expect(account(options)).toBe("acc-1");
    expect(options.permissionMode).toBeUndefined();
});

test("headless codex drops sandbox, approval and bypass", () => {
    settings.codex.sandbox = "danger-full-access";
    mountWith("codex", {
        headless: true,
        value: { type: "codex", model: "gpt-5.6-luna", approvalPolicy: "never" },
    });
    const options = lastEmitted();
    if (options.type !== "codex") throw new Error("expected codex options");
    expect(options.model).toBe("gpt-5.6-luna");
    expect(options.sandbox).toBeUndefined();
    expect(options.approvalPolicy).toBeUndefined();
    expect(options.dangerouslyBypassApprovalsAndSandbox).toBeUndefined();
});
```

Create `packages/ui/src/components/shared/ClaudeOptions.headless.test.tsx`:

```tsx
import { afterAll, beforeEach, expect, test } from "bun:test";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { ClaudeOptions } from "./ClaudeOptions";

// @ts-expect-error react act env flag, no upstream type for this global
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let container: HTMLDivElement | null = null;

function render(headless: boolean) {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
        root?.render(
            <ClaudeOptions
                modelValue="default"
                effortValue="default"
                permissionMode="default"
                onModelChange={() => {}}
                onEffortChange={() => {}}
                onPermissionModeChange={() => {}}
                headless={headless}
            />,
        );
    });
}

function cleanup() {
    if (root) act(() => root?.unmount());
    root = null;
    container?.remove();
    container = null;
}

beforeEach(cleanup);
afterAll(cleanup);

test("headless hides the permission mode row", () => {
    render(true);
    expect(container?.textContent).toContain("Model");
    expect(container?.textContent).not.toContain("Permission Mode");
});

test("session mode shows the permission mode row", () => {
    render(false);
    expect(container?.textContent).toContain("Permission Mode");
});
```

- [ ] **Step 2: Run the tests and check that they fail**

Run each file separately:
`bun test packages/ui/src/components/workspace/AgentOptionsPanel.test.tsx`
`bun test packages/ui/src/components/shared/ClaudeOptions.headless.test.tsx`
Expected: FAIL. The `headless` prop doesn't exist yet (a TS error at runtime is ignored by bun, but the headless assertions fail), and "Permission Mode" is still rendered.

- [ ] **Step 3: Add `headless` to each per-agent options component**

For each file, add the prop to the props interface with this doc comment: `/** One-shot headless run: hide fields that only matter to an interactive session. */ headless?: boolean;`. Add `headless = false` to the destructuring, then wrap the listed rows in `{!headless && ( … )}`:
- `ClaudeOptions.tsx`: the `<SettingRow label={l.permissionMode} …>` row.
- `CodexOptions.tsx`: the three rows `labels.bypass`, `labels.sandbox`, `labels.approvalPolicy`, inside one `{!headless && (<> … </>)}`.
- `OpenCodeOptions.tsx`: the `l.autoApprove` row.
- `PiOptions.tsx`: the `l.tools` row.
- `KimiOptions.tsx`: the `l.permission` row.

- [ ] **Step 4: Add `headless` to `AgentOptionsPanel`**

In `packages/ui/src/components/workspace/AgentOptionsPanel.tsx`:

Add to `AgentOptionsPanelProps`:

```ts
    /**
     * One-shot text generation (built-in helpers). Hides and omits
     * session-only fields (permissions, sandbox, approvals, auto-approve,
     * tools) and does not prefill from the machine's session defaults: an
     * unset field means the agent CLI's own default.
     */
    headless?: boolean;
```

Add `headless = false,` to the destructured props.

Replace the settings lines at the top of the component body:

```ts
    const settings = useSettingsStore((s) =>
        backendId ? (s.byBackend[backendId] ?? null) : s.settings,
    );
    // Headless runs don't use the machine's session defaults.
    const defaults = headless ? null : settings;
    const claudeSettings = defaults?.claude;
    const codexSettings = defaults?.codex;
    const opencodeSettings = defaults?.opencode;
    const piSettings = defaults?.pi;
    const kimiSettings = defaults?.kimi;
```

Change `accountList` to read accounts from `settings`, not `defaults`, because accounts must stay listed in headless mode:

```ts
    const accountList =
        agentType === "claude"
            ? (settings?.claude.accounts ?? [])
            : agentType === "codex"
              ? (settings?.codex.accounts ?? [])
              : [];
```

In the builders, omit the session-only fields when `headless`, and add `headless` to each `useCallback` dependency list:
- `buildClaudeOptions`: `permissionMode: headless || permissionMode === "default" ? undefined : (permissionMode as ClaudePermissionMode),`
- `buildCodexOptions`: `sandbox: headless ? undefined : codexSandbox || undefined,` `approvalPolicy: headless ? undefined : approvalPolicy || undefined,` `dangerouslyBypassApprovalsAndSandbox: headless ? undefined : dangerouslyBypassApprovalsAndSandbox || undefined,`
- `buildOpenCodeOptions`: `autoApprove: headless ? undefined : ocAutoApprove || undefined,`
- `buildPiOptions`: `tools: headless ? undefined : piTools.trim() || undefined,`
- `buildKimiOptions`: `permissionMode: headless || kimiPermissionMode === "manual" ? undefined : kimiPermissionMode,`

Pass `headless={headless}` to each of `<ClaudeOptions>`, `<CodexOptions>`, `<OpenCodeOptions>`, `<PiOptions>` and `<KimiOptions>`.

- [ ] **Step 5: Move the snapshot helper and add `confirmLabel`**

In `packages/ui/src/lib/normalize-agent-options.ts`, add the following and export it next to `normalizeAgentOptions`:

```ts
/** Snapshot shape for change detection: agent types always yield an object. */
function agentOptionsSnapshot(
    sessionType: SessionType,
    agentOptions: AgentLaunchOptions | undefined,
): AgentLaunchOptions | undefined {
    if (sessionType === "shell") return undefined;
    return normalizeAgentOptions(sessionType, agentOptions) ?? { type: sessionType };
}
```

In `ActionEditor.tsx`, delete the local `snapshotAgentOptions` function. Import `agentOptionsSnapshot` from `@/lib/normalize-agent-options` (the file already imports `normalizeAgentOptions` from it; drop that import if it becomes unused) and replace both call sites.

In `packages/ui/src/components/ui/confirm-delete-dialog.tsx`, add `confirmLabel?: string;` to the props, destructure it as `confirmLabel = "Delete",`, and render `{confirmLabel}` in place of the literal `Delete`.

- [ ] **Step 6: Add built-ins to the flow store**

In `packages/ui/src/stores/flow-store.ts`:
- Add `BuiltinActionDefinition`, `BuiltinActionId`, `BuiltinActionOverride` and `BuiltinActionsListResponse` to the `import type` from `@taskflow/shared`.
- Add to the `FlowStore` interface after `actions`:

```ts
    /** Built-in action definitions (defaults merged with overrides), per machine. */
    builtinActions: Scoped<BuiltinActionDefinition>[];
```

  and after `deleteAction(...)`:

```ts
    fetchBuiltinActions(backendId: string): Promise<void>;
    saveBuiltinAction(backendId: string, override: BuiltinActionOverride): Promise<void>;
    resetBuiltinAction(backendId: string, id: BuiltinActionId): Promise<void>;
```

- After `const actionSlices = createSlices<ActionDefinition>();` add `const builtinSlices = createSlices<BuiltinActionDefinition>();`.
- Change `publishDefinitions` to:

```ts
function publishDefinitions(): void {
    useFlowStore.setState({
        flows: slices.read(),
        actions: actionSlices.read(),
        builtinActions: builtinSlices.read(),
    });
}
```

- In the initial state, add `builtinActions: [],` after `actions: [],`.
- Add these methods after `deleteAction`:

```ts
    async fetchBuiltinActions(backendId) {
        await trackDefinitionLoad(() =>
            builtinSlices.load(backendId, async () => {
                const { actions } = await sendRequest<BuiltinActionsListResponse>(
                    backendId,
                    MSG.BUILTIN_ACTIONS_LIST,
                );
                return actions;
            }),
        );
    },

    async saveBuiltinAction(backendId, override) {
        const saved = await sendRequest<BuiltinActionDefinition>(
            backendId,
            MSG.BUILTIN_ACTION_SAVE,
            override,
        );
        builtinSlices.apply(backendId, (items) => upsertById(items, { ...saved, backendId }));
        publishDefinitions();
    },

    async resetBuiltinAction(backendId, id) {
        const reset = await sendRequest<BuiltinActionDefinition>(
            backendId,
            MSG.BUILTIN_ACTION_RESET,
            { id },
        );
        builtinSlices.apply(backendId, (items) => upsertById(items, { ...reset, backendId }));
        publishDefinitions();
    },
```

- In `registerBackendReset("flow-store", …)`, add `builtinSlices.drop(backendId);` and `builtinActions: builtinSlices.read(),` next to the existing action equivalents.

- [ ] **Step 7: Run the tests and check that they pass**

Run each separately:
`bun test packages/ui/src/components/workspace/AgentOptionsPanel.test.tsx`
`bun test packages/ui/src/components/shared/ClaudeOptions.headless.test.tsx`
`bun test packages/ui/src/components/flows/FlowEditor.library.test.tsx`
`bun test packages/ui/src/components/flows/FlowEditor.loop.test.tsx`
Then: `bun run typecheck`
Expected: all PASS; typecheck exits 0.

- [ ] **Step 8: Commit**

```bash
bunx prettier --write packages/ui/src/stores/flow-store.ts packages/ui/src/lib/normalize-agent-options.ts packages/ui/src/components/flows/ActionEditor.tsx packages/ui/src/components/workspace/AgentOptionsPanel.tsx packages/ui/src/components/workspace/AgentOptionsPanel.test.tsx packages/ui/src/components/shared/ClaudeOptions.tsx packages/ui/src/components/shared/CodexOptions.tsx packages/ui/src/components/shared/OpenCodeOptions.tsx packages/ui/src/components/shared/PiOptions.tsx packages/ui/src/components/shared/KimiOptions.tsx packages/ui/src/components/shared/ClaudeOptions.headless.test.tsx packages/ui/src/components/ui/confirm-delete-dialog.tsx
git add packages/ui
git commit -m "feat(ui): built-in actions in the flow store and a headless agent options mode"
```

---

### Task 6: Built-in action editor and the "Built-in" filter

**Files:**
- Create: `packages/ui/src/components/flows/BuiltinActionEditor.tsx`
- Create: `packages/ui/src/components/flows/BuiltinActionEditor.test.tsx`
- Modify: `packages/ui/src/components/flows/FlowManagementDialog.tsx`
- Create: `packages/ui/src/components/flows/FlowManagementDialog.builtin.test.tsx`

**Interfaces:**
- Consumes: Task 5 store methods, `AgentOptionsPanel` `headless`, `agentOptionsSnapshot`, `ConfirmDeleteDialog` `confirmLabel`; Task 1 `missingPromptVariables`, `builtinActionFollowsDefaultAgent`.
- Produces: `BuiltinActionEditor` with props `{ action: BuiltinActionDefinition; backendId: string | null; onSave: (override: BuiltinActionOverride) => Promise<void>; onReset: () => Promise<void>; onCancel: () => void }`

- [ ] **Step 1: Write the failing editor test** — `packages/ui/src/components/flows/BuiltinActionEditor.test.tsx`

```tsx
import { afterAll, beforeEach, expect, mock, test } from "bun:test";
import { act } from "react";
import type { ComponentProps, ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import type {
    AgentLaunchOptions,
    AgentType,
    BuiltinActionDefinition,
    BuiltinActionOverride,
} from "@taskflow/shared";
import { BUILTIN_ACTION_DEFAULTS } from "@taskflow/shared";

// The editor reads its machine's settings from byBackend.
interface MockSettingsState {
    settings: { general: { defaultAgent: AgentType } };
    byBackend: Record<string, { general: { defaultAgent: AgentType } }>;
}
await mock.module("@/stores/settings-store", () => ({
    useSettingsStore: <T,>(selector: (s: MockSettingsState) => T): T =>
        selector({
            settings: { general: { defaultAgent: "claude" } },
            byBackend: { b1: { general: { defaultAgent: "codex" } } },
        }),
}));

// Monaco-backed textarea does not work in happy-dom.
await mock.module("@/components/ui/expandable-textarea", () => ({
    ExpandableTextarea: ({
        dialogTitle: _dialogTitle,
        ...props
    }: ComponentProps<"textarea"> & { dialogTitle?: string }) => <textarea {...props} />,
}));

let panelProps: { headless?: boolean; agentType?: AgentType } = {};
await mock.module("@/components/workspace/AgentOptionsPanel", () => ({
    AgentOptionsPanel: (props: {
        agentType: AgentType;
        headless?: boolean;
        onChange?: (options: AgentLaunchOptions) => void;
    }) => {
        panelProps = props;
        return (
            <button
                id="pick-model"
                onClick={() => props.onChange?.({ type: props.agentType, model: "picked" })}>
                pick model
            </button>
        );
    },
}));

// Radix select renders its item labels only when open; a native select keeps the contract.
await mock.module("@/components/ui/select", () => ({
    Select: ({
        value,
        onValueChange,
        children,
    }: {
        value: string;
        onValueChange: (v: string) => void;
        children: ReactNode;
    }) => (
        <select id="agent" value={value} onChange={(e) => onValueChange(e.target.value)}>
            {children}
        </select>
    ),
    SelectTrigger: () => null,
    SelectValue: () => null,
    SelectContent: ({ children }: { children: ReactNode }) => <>{children}</>,
    SelectItem: ({ value, children }: { value: string; children: ReactNode }) => (
        <option value={value}>{children}</option>
    ),
}));

await mock.module("@/components/ui/confirm-delete-dialog", () => ({
    ConfirmDeleteDialog: ({
        open,
        onConfirm,
        confirmLabel,
    }: {
        open: boolean;
        onConfirm: () => void;
        confirmLabel?: string;
    }) => (open ? <button onClick={onConfirm}>{`confirm ${confirmLabel ?? ""}`}</button> : null),
}));

const { BuiltinActionEditor } = await import("./BuiltinActionEditor");

// @ts-expect-error react act env flag, no upstream type for this global
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let container: HTMLDivElement | null = null;
let saved: BuiltinActionOverride[] = [];
let resets = 0;

function title(overrides: Partial<BuiltinActionDefinition> = {}): BuiltinActionDefinition {
    return { ...BUILTIN_ACTION_DEFAULTS["builtin:task-title"], isModified: false, ...overrides };
}

async function mount(action: BuiltinActionDefinition) {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
        root?.render(
            <BuiltinActionEditor
                action={action}
                backendId="b1"
                onSave={async (o) => {
                    saved.push(o);
                }}
                onReset={async () => {
                    resets++;
                }}
                onCancel={() => {}}
            />,
        );
    });
}

function unmount() {
    if (root) act(() => root?.unmount());
    root = null;
    container?.remove();
    container = null;
}

function button(label: string): HTMLButtonElement {
    const found = [...document.body.querySelectorAll("button")].find(
        (b) => b.textContent?.trim() === label,
    );
    if (!found) throw new Error(`No button labelled ${label}`);
    return found;
}

function typePrompt(value: string) {
    const textarea = document.body.querySelector("#builtin-action-prompt");
    if (!(textarea instanceof HTMLTextAreaElement)) throw new Error("no prompt textarea");
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
    act(() => {
        setter?.call(textarea, value);
        textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });
}

beforeEach(() => {
    unmount();
    saved = [];
    resets = 0;
    panelProps = {};
});
afterAll(unmount);

test("save is disabled until something changes", async () => {
    await mount(title());
    expect(button("Save").disabled).toBe(true);
});

test("a prompt missing a required placeholder cannot be saved", async () => {
    await mount(title());
    typePrompt("Name this task");
    expect(document.body.textContent).toContain("{{description}}");
    expect(button("Save").disabled).toBe(true);
});

test("saves the edited prompt with the existing agent and options", async () => {
    await mount(title());
    typePrompt("Short title for: {{description}}");
    await act(async () => {
        button("Save").click();
    });
    expect(saved).toHaveLength(1);
    expect(saved[0].id).toBe("builtin:task-title");
    expect(saved[0].prompt).toBe("Short title for: {{description}}");
    expect(saved[0].sessionType).toBe("claude");
    expect(saved[0].agentOptions).toEqual({ type: "claude", model: "haiku" });
});

test("saves agent option changes", async () => {
    await mount(title());
    act(() => button("pick model").click());
    await act(async () => {
        button("Save").click();
    });
    expect(saved[0].agentOptions).toEqual({ type: "claude", model: "picked" });
});

test("headless built-ins use the headless options panel, the commit built-in does not", async () => {
    await mount(title());
    expect(panelProps.headless).toBe(true);
    unmount();
    await mount({ ...BUILTIN_ACTION_DEFAULTS["builtin:commit"], sessionType: "claude", isModified: true });
    expect(panelProps.headless).toBe(false);
});

test("reset is disabled for an unmodified built-in and confirms before resetting", async () => {
    await mount(title());
    expect(button("Reset to default").disabled).toBe(true);
    unmount();

    await mount(title({ isModified: true, prompt: "X {{description}}" }));
    act(() => button("Reset to default").click());
    await act(async () => {
        button("confirm Reset").click();
    });
    expect(resets).toBe(1);
});

test("switching the agent clears the options and saves the new agent", async () => {
    await mount(title());
    const select = document.body.querySelector("#agent");
    if (!(select instanceof HTMLSelectElement)) throw new Error("no agent select");
    act(() => {
        select.value = "codex";
        select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(panelProps.agentType).toBe("codex");
    await act(async () => {
        button("Save").click();
    });
    expect(saved[0].sessionType).toBe("codex");
    expect(saved[0].agentOptions).toBeUndefined();
});

test("the commit built-in following the default agent names that agent", async () => {
    await mount({ ...BUILTIN_ACTION_DEFAULTS["builtin:commit"], isModified: false });
    expect(document.body.textContent).toContain("Default agent (Codex)");
});
```

- [ ] **Step 2: Run the test and check that it fails**

Run: `bun test packages/ui/src/components/flows/BuiltinActionEditor.test.tsx`
Expected: FAIL — module `./BuiltinActionEditor` not found.

- [ ] **Step 3: Create `packages/ui/src/components/flows/BuiltinActionEditor.tsx`**

```tsx
import { useCallback, useMemo, useState } from "react";
import type {
    AgentLaunchOptions,
    AgentType,
    BuiltinActionDefinition,
    BuiltinActionOverride,
} from "@taskflow/shared";
import {
    AGENT_DISPLAY_NAMES,
    ALL_AGENT_TYPES,
    builtinActionFollowsDefaultAgent,
    isAgentType,
    missingPromptVariables,
} from "@taskflow/shared";
import { Button } from "@/components/ui/button";
import { ConfirmDeleteDialog } from "@/components/ui/confirm-delete-dialog";
import { ExpandableTextarea } from "@/components/ui/expandable-textarea";
import { Label } from "@/components/ui/label";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { AgentOptionsPanel } from "@/components/workspace/AgentOptionsPanel";
import { useSettingsStore } from "@/stores/settings-store";
import { agentOptionsSnapshot } from "@/lib/normalize-agent-options";

const DEFAULT_AGENT_VALUE = "__default__";

interface BuiltinActionEditorProps {
    action: BuiltinActionDefinition;
    /** The machine the built-in belongs to; its default agent labels "Default agent". */
    backendId: string | null;
    onSave: (override: BuiltinActionOverride) => Promise<void>;
    onReset: () => Promise<void>;
    onCancel: () => void;
}

function snapshot(
    prompt: string,
    sessionType: AgentType | undefined,
    agentOptions: AgentLaunchOptions | undefined,
): string {
    return JSON.stringify({
        prompt,
        sessionType: sessionType ?? null,
        agentOptions: sessionType ? agentOptionsSnapshot(sessionType, agentOptions) : null,
    });
}

function BuiltinActionEditor({
    action,
    backendId,
    onSave,
    onReset,
    onCancel,
}: BuiltinActionEditorProps) {
    const defaultAgent = useSettingsStore(
        (s) => (backendId ? s.byBackend[backendId] : s.settings)?.general.defaultAgent ?? "claude",
    );
    const [prompt, setPrompt] = useState(action.prompt);
    const [sessionType, setSessionType] = useState<AgentType | undefined>(action.sessionType);
    const [agentOptions, setAgentOptions] = useState<AgentLaunchOptions | undefined>(
        action.agentOptions,
    );
    const [optionsKey, setOptionsKey] = useState(0);
    const [confirmReset, setConfirmReset] = useState(false);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const missing = useMemo(
        () => missingPromptVariables(prompt, action.variables),
        [prompt, action.variables],
    );
    const initialSnapshot = useMemo(
        () => snapshot(action.prompt, action.sessionType, action.agentOptions),
        [action],
    );
    const hasChanges = initialSnapshot !== snapshot(prompt, sessionType, agentOptions);
    const canSave = hasChanges && prompt.trim() !== "" && missing.length === 0 && !busy;
    const followsDefault = builtinActionFollowsDefaultAgent(action.id);

    const handleAgentChange = useCallback((value: string) => {
        setSessionType(isAgentType(value) ? value : undefined);
        setAgentOptions(undefined);
        setOptionsKey((key) => key + 1);
    }, []);

    const handleResetOptions = useCallback(() => {
        setAgentOptions(undefined);
        setOptionsKey((key) => key + 1);
    }, []);

    const run = useCallback(async (work: () => Promise<void>) => {
        setError(null);
        setBusy(true);
        try {
            await work();
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
        } finally {
            setBusy(false);
        }
    }, []);

    const handleSave = useCallback(
        () =>
            run(() =>
                onSave({
                    id: action.id,
                    prompt,
                    sessionType,
                    agentOptions: sessionType ? agentOptions : undefined,
                    updatedAt: new Date().toISOString(),
                }),
            ),
        [run, onSave, action.id, prompt, sessionType, agentOptions],
    );

    const handleConfirmReset = useCallback(() => {
        setConfirmReset(false);
        void run(onReset);
    }, [run, onReset]);

    return (
        <div className="flex h-full flex-col">
            <div className="flex-1 overflow-y-auto px-6 py-5">
                <h3 className="text-base font-semibold">{action.name}</h3>
                <p className="text-muted-foreground mt-1 mb-5 text-sm">{action.description}</p>

                <div className="flex flex-col gap-4">
                    <div className="flex flex-col gap-1.5">
                        <Label
                            htmlFor="builtin-action-agent"
                            className="text-muted-foreground text-[11px] font-medium tracking-wider uppercase">
                            Agent
                        </Label>
                        <Select
                            value={sessionType ?? DEFAULT_AGENT_VALUE}
                            onValueChange={handleAgentChange}>
                            <SelectTrigger id="builtin-action-agent" size="sm">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                {followsDefault && (
                                    <SelectItem value={DEFAULT_AGENT_VALUE}>
                                        {`Default agent (${AGENT_DISPLAY_NAMES[defaultAgent]})`}
                                    </SelectItem>
                                )}
                                {ALL_AGENT_TYPES.map((type) => (
                                    <SelectItem key={type} value={type}>
                                        {AGENT_DISPLAY_NAMES[type]}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>

                    <div className="flex flex-col gap-1.5">
                        <Label
                            htmlFor="builtin-action-prompt"
                            className="text-muted-foreground text-[11px] font-medium tracking-wider uppercase">
                            Prompt
                        </Label>
                        <ExpandableTextarea
                            id="builtin-action-prompt"
                            value={prompt}
                            onChange={(e) => setPrompt(e.target.value)}
                            className="min-h-[200px] text-sm"
                            dialogTitle={action.name}
                        />
                        <ul className="text-muted-foreground flex flex-col gap-0.5 text-xs">
                            {action.variables.map((variable) => (
                                <li key={variable.name}>
                                    <code>{`{{${variable.name}}}`}</code> — {variable.description}
                                </li>
                            ))}
                        </ul>
                        {missing.length > 0 && (
                            <p className="text-destructive text-xs">
                                {`The prompt must include ${missing.map((name) => `{{${name}}}`).join(", ")}`}
                            </p>
                        )}
                    </div>

                    {sessionType && (
                        <div className="border-border rounded-md border p-3">
                            <AgentOptionsPanel
                                key={`${action.id}-${sessionType}-${optionsKey}`}
                                backendId={backendId ?? undefined}
                                agentType={sessionType}
                                value={agentOptions}
                                headless={action.mode === "headless"}
                                onChange={setAgentOptions}
                                onReset={handleResetOptions}
                            />
                        </div>
                    )}

                    {error && <p className="text-destructive text-sm">{error}</p>}
                </div>
            </div>

            <div className="flex shrink-0 items-center gap-2 px-6 py-3">
                <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => setConfirmReset(true)}
                    disabled={!action.isModified || busy}>
                    Reset to default
                </Button>
                <ConfirmDeleteDialog
                    open={confirmReset}
                    onOpenChange={setConfirmReset}
                    onConfirm={handleConfirmReset}
                    title="Reset this built-in action?"
                    description="Its prompt, agent and options go back to the defaults."
                    confirmLabel="Reset"
                />
                <div className="flex-1" />
                <Button variant="secondary" size="sm" onClick={onCancel}>
                    Cancel
                </Button>
                <Button size="sm" onClick={() => void handleSave()} disabled={!canSave}>
                    Save
                </Button>
            </div>
        </div>
    );
}

export { BuiltinActionEditor };
```

Note: `emitOnMount` is intentionally **not** passed to `AgentOptionsPanel`. Options change only when the user touches the panel, so an untouched panel never writes session defaults into the override.

- [ ] **Step 4: Run the editor test and check that it passes**

Run: `bun test packages/ui/src/components/flows/BuiltinActionEditor.test.tsx`
Expected: PASS.

- [ ] **Step 5: Write the failing dialog test** — `packages/ui/src/components/flows/FlowManagementDialog.builtin.test.tsx`

```tsx
import { afterAll, beforeEach, expect, mock, test } from "bun:test";
import { act } from "react";
import type { ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { BuiltinActionDefinition } from "@taskflow/shared";
import { BUILTIN_ACTION_DEFAULTS } from "@taskflow/shared";

const fetched: string[] = [];
const builtinActions = Object.values(BUILTIN_ACTION_DEFAULTS).map(
    (def): BuiltinActionDefinition & { backendId: string } => ({
        ...def,
        isModified: def.id === "builtin:task-title",
        backendId: "primary",
    }),
);
const flowState = {
    flows: [],
    actions: [],
    builtinActions,
    fetchFlows: async () => {},
    fetchActions: async () => {},
    fetchBuiltinActions: async (backendId: string) => {
        fetched.push(backendId);
    },
    saveBuiltinAction: async () => {},
    resetBuiltinAction: async () => {},
};
await mock.module("@/stores/flow-store", () => ({
    useFlowStore: Object.assign(
        <T,>(selector: (s: typeof flowState) => T): T => selector(flowState),
        { getState: () => flowState },
    ),
}));

const uiState = { flowManagementOpen: true, toggleFlowManagement: () => {}, activeProjectId: null };
await mock.module("@/stores/ui-store", () => ({
    useUIStore: <T,>(selector: (s: typeof uiState) => T): T => selector(uiState),
}));
await mock.module("@/stores/project-store", () => ({
    useProjectStore: <T,>(selector: (s: { projects: [] }) => T): T => selector({ projects: [] }),
}));
await mock.module("@/hooks/usePrimaryBackend", () => ({ usePrimaryBackend: () => "primary" }));

await mock.module("@/components/ui/dialog", () => ({
    Dialog: ({ open, children }: { open?: boolean; children: ReactNode }) =>
        open ? <>{children}</> : null,
    DialogContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
    DialogHeader: ({ children }: { children: ReactNode }) => <div>{children}</div>,
    DialogTitle: ({ children }: { children: ReactNode }) => <h2>{children}</h2>,
}));

// Radix select is not drivable in happy-dom; a native select keeps the same contract.
await mock.module("@/components/ui/select", () => ({
    Select: ({
        value,
        onValueChange,
        children,
    }: {
        value: string;
        onValueChange: (v: string) => void;
        children: ReactNode;
    }) => (
        <select id="filter" value={value} onChange={(e) => onValueChange(e.target.value)}>
            {children}
        </select>
    ),
    SelectTrigger: () => null,
    SelectValue: () => null,
    SelectContent: ({ children }: { children: ReactNode }) => <>{children}</>,
    SelectItem: ({ value, children }: { value: string; children: ReactNode }) => (
        <option value={value}>{children}</option>
    ),
}));

await mock.module("./FlowEditor", () => ({ FlowEditor: () => <div>flow editor</div> }));
await mock.module("./ActionEditor", () => ({ ActionEditor: () => <div>action editor</div> }));
await mock.module("./BuiltinActionEditor", () => ({
    BuiltinActionEditor: ({ action }: { action: BuiltinActionDefinition }) => (
        <div>{`builtin editor: ${action.id}`}</div>
    ),
}));

const { FlowManagementDialog } = await import("./FlowManagementDialog");

// @ts-expect-error react act env flag, no upstream type for this global
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let container: HTMLDivElement | null = null;

async function mount() {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
        root?.render(<FlowManagementDialog />);
    });
}

function unmount() {
    if (root) act(() => root?.unmount());
    root = null;
    container?.remove();
    container = null;
}

function chooseFilter(value: string) {
    const select = document.body.querySelector("#filter");
    if (!(select instanceof HTMLSelectElement)) throw new Error("no filter");
    act(() => {
        select.value = value;
        select.dispatchEvent(new Event("change", { bubbles: true }));
    });
}

function buttonWithText(text: string): HTMLButtonElement {
    const found = [...document.body.querySelectorAll("button")].find((b) =>
        b.textContent?.includes(text),
    );
    if (!found) throw new Error(`No button containing ${text}`);
    return found;
}

beforeEach(() => {
    unmount();
    fetched.length = 0;
});
afterAll(unmount);

test("fetches built-ins on open and keeps them out of All", async () => {
    await mount();
    expect(fetched).toEqual(["primary"]);
    expect(document.body.textContent).not.toContain("Generate task title");
});

test("the Built-in filter lists built-ins, marks modified ones, hides create", async () => {
    await mount();
    chooseFilter("builtin");
    expect(document.body.textContent).toContain("Generate task title");
    expect(document.body.textContent).toContain("Commit with agent");
    expect(document.body.textContent).toContain("Modified");
    expect(document.body.querySelector('button[title="New action"]')).toBeNull();
});

test("selecting a built-in opens its editor", async () => {
    await mount();
    chooseFilter("builtin");
    act(() => buttonWithText("Generate commit message").click());
    expect(document.body.textContent).toContain("builtin editor: builtin:commit-message");
});

test("the Flows tab explains built-ins can't be used in flows", async () => {
    await mount();
    chooseFilter("builtin");
    act(() => buttonWithText("Flows").click());
    expect(document.body.textContent).toContain("Built-in actions can't be used in flows");
    expect(document.body.textContent).not.toContain("No flows yet");
});
```

- [ ] **Step 6: Run the dialog test and check that it fails**

Run: `bun test packages/ui/src/components/flows/FlowManagementDialog.builtin.test.tsx`
Expected: FAIL — `fetched` is empty, and there's no "builtin" option.

- [ ] **Step 7: Update `FlowManagementDialog.tsx`**

Make these exact edits:

1. Imports: add `BuiltinActionOverride` to the `import type` from `@taskflow/shared`, and `import { BuiltinActionEditor } from "./BuiltinActionEditor";`.
2. After the `actions` memo, add:

```ts
    const allBuiltinActions = useFlowStore((s) => s.builtinActions);
    const builtinActions = useMemo(
        () => allBuiltinActions.filter((action) => action.backendId === primaryId),
        [allBuiltinActions, primaryId],
    );
```

3. Update the filter comment to: `// "all" = user flows/actions, "global" = only global, "builtin" = built-in actions, otherwise a projectId`, and add `const isBuiltinFilter = projectFilter === "builtin";` right after the `useState` line.
4. In the fetch effect, destructure `fetchBuiltinActions` too and add `void fetchBuiltinActions(primaryId);`.
5. In the filter-validation effect, change the first line to `if (projectFilter === "all" || projectFilter === "global" || projectFilter === "builtin") return;`.
6. In `filteredFlows` and `filteredActions`, add as the first line of each memo body: `if (projectFilter === "builtin") return [];`.
7. Change `defaultProjectId` to:

```ts
    const defaultProjectId =
        projectFilter !== "all" && projectFilter !== "global" && projectFilter !== "builtin"
            ? projectFilter
            : undefined;
```

8. After `selectedAction`, add:

```ts
    const selectedBuiltin =
        tab === "actions" && isBuiltinFilter
            ? (builtinActions.find((a) => a.id === selectedId) ?? null)
            : null;
```

9. After `handleDeleteAction`, add:

```ts
    const handleSaveBuiltin = useCallback(
        async (override: BuiltinActionOverride) => {
            if (!primaryId) throw new Error("Not connected to a backend");
            await useFlowStore.getState().saveBuiltinAction(primaryId, override);
        },
        [primaryId],
    );

    const handleResetBuiltin = useCallback(async () => {
        if (!primaryId || !selectedBuiltin) return;
        await useFlowStore.getState().resetBuiltinAction(primaryId, selectedBuiltin.id);
    }, [primaryId, selectedBuiltin]);
```

10. In the filter `<SelectContent>`, add `<SelectItem value="builtin">Built-in</SelectItem>` right after the "Global" item.
11. In the list column:
    - Change the flows empty-state condition to `tab === "flows" && !isBuiltinFilter && filteredFlows.length === 0`, and add:

```tsx
                            {tab === "flows" && isBuiltinFilter && (
                                <div className="text-muted-foreground px-3 py-6 text-center text-xs">
                                    Built-in actions can&apos;t be used in flows
                                </div>
                            )}
```

    - Change the actions empty-state condition to `tab === "actions" && !isBuiltinFilter && filteredActions.length === 0`, and add the built-in rows:

```tsx
                            {tab === "actions" &&
                                isBuiltinFilter &&
                                builtinActions.map((b) => (
                                    <button
                                        key={b.id}
                                        onClick={() => selectItem(b.id)}
                                        className={`mb-0.5 w-full rounded-md px-2.5 py-2 text-left text-[13px] transition-colors ${
                                            selectedId === b.id
                                                ? "bg-muted text-foreground font-medium"
                                                : "text-secondary-foreground hover:bg-muted/50"
                                        }`}>
                                        <div className="font-medium">{b.name}</div>
                                        <div className="text-muted-foreground mt-0.5 flex items-center gap-1.5 text-xs">
                                            <span>{b.sessionType ?? "Default agent"}</span>
                                            {b.isModified && (
                                                <span className="bg-muted rounded px-1">Modified</span>
                                            )}
                                        </div>
                                    </button>
                                ))}
```

    - Wrap the `<div className="flex justify-end p-1">` with the ➕ button in `{!isBuiltinFilter && ( … )}`.
12. In the editor column, before the placeholder block, add:

```tsx
                        {selectedBuiltin && (
                            <BuiltinActionEditor
                                key={`${selectedBuiltin.id}-${selectedBuiltin.updatedAt ?? "default"}`}
                                action={selectedBuiltin}
                                backendId={primaryId}
                                onSave={handleSaveBuiltin}
                                onReset={handleResetBuiltin}
                                onCancel={clearSelection}
                            />
                        )}
```

    Then change the placeholder condition to `!creating && !selectedFlow && !selectedAction && !selectedBuiltin`, and make its text conditional:

```tsx
                                {isBuiltinFilter ? (
                                    "Select a built-in action"
                                ) : (
                                    <>
                                        Select an item or click{" "}
                                        <Plus className="mx-1 inline h-4 w-4" /> to create
                                    </>
                                )}
```

The editor's `key` includes `updatedAt`, so saving or resetting remounts it with fresh state.

- [ ] **Step 8: Run the tests and check that they pass**

Run each separately:
`bun test packages/ui/src/components/flows/FlowManagementDialog.builtin.test.tsx`
`bun test packages/ui/src/components/flows/BuiltinActionEditor.test.tsx`
Then `bun run typecheck`.
Expected: PASS; typecheck exits 0.

- [ ] **Step 9: Commit**

```bash
bunx prettier --write packages/ui/src/components/flows/BuiltinActionEditor.tsx packages/ui/src/components/flows/BuiltinActionEditor.test.tsx packages/ui/src/components/flows/FlowManagementDialog.tsx packages/ui/src/components/flows/FlowManagementDialog.builtin.test.tsx
git add packages/ui
git commit -m "feat(ui): edit and reset built-in actions from Actions and Flows"
```

---

### Task 7: Commit dialog uses the built-in commit action

**Files:**
- Modify: `packages/ui/src/components/workspace/CommitDialog.tsx`
- Modify: `packages/ui/src/components/workspace/CommitDialog.test.tsx`

**Interfaces — Consumes:** `MSG.BUILTIN_ACTIONS_LIST`, `BuiltinActionsListResponse`, `BUILTIN_ACTION_DEFAULTS` and `renderPromptTemplate` (Task 1).

- [ ] **Step 1: Rewrite the tests** — replace `packages/ui/src/components/workspace/CommitDialog.test.tsx`

Keep the existing `createSession`, session-store, settings-store (default agent `"codex"`), dialog and expandable-textarea mocks, plus the `click`, `findButton`, `mount` and `unmount` helpers exactly as they are. Delete the `useAgentAvailability` and `AgentOptionsPanel` mocks. Replace the `useWorkspaceRequest` mock and the two tests with:

```tsx
let builtinList: BuiltinActionDefinition[] | Error = [];
const requestTypes: string[] = [];

// Git requests go to the workspace's machine; so does the built-in lookup.
await mock.module("@/hooks/useWorkspaceRequest", () => ({
    useWorkspaceRequest: () => (type: string): Promise<unknown> => {
        requestTypes.push(type);
        if (type === MSG.BUILTIN_ACTIONS_LIST) {
            return builtinList instanceof Error
                ? Promise.reject(builtinList)
                : Promise.resolve({ actions: builtinList });
        }
        return Promise.resolve({
            status: {
                branch: "main",
                stagedFiles: [],
                unstagedFiles: [{ path: "changed.ts", status: "modified", staged: false }],
                ahead: 0,
                behind: 0,
            },
        });
    },
}));
```

Update the imports at the top: `import type { AgentType, BuiltinActionDefinition, GitStatusResponse } from "@taskflow/shared";` and `import { BUILTIN_ACTION_DEFAULTS, MSG } from "@taskflow/shared";`. Drop `GitStatusResponse` if it becomes unused. In `beforeEach`, add `requestTypes.length = 0;` and `builtinList = [{ ...BUILTIN_ACTION_DEFAULTS["builtin:commit"], isModified: false }];`.

```tsx
async function commitWithAgent(): Promise<void> {
    await mount();
    const useAgentSwitch = document.body.querySelector("#commit-use-agent");
    if (!useAgentSwitch) throw new Error("Use agent switch was not rendered");
    click(useAgentSwitch);
    await act(async () => {
        findButton("Commit").click();
    });
}

test("the dialog no longer offers agent pickers and points to the built-in", async () => {
    await mount();
    const useAgentSwitch = document.body.querySelector("#commit-use-agent");
    if (!useAgentSwitch) throw new Error("Use agent switch was not rendered");
    click(useAgentSwitch);
    expect(document.body.querySelector("#commit-agent")).toBeNull();
    expect(document.body.textContent).not.toContain("Agent Options");
    expect(document.body.textContent).toContain("Actions and Flows → Built-in");
});

test("the default built-in runs on the machine's default agent with today's prompt", async () => {
    await commitWithAgent();
    expect(requestTypes).toContain(MSG.BUILTIN_ACTIONS_LIST);
    expect(createSessionCalls).toHaveLength(1);
    expect(createSessionCalls[0]?.[1]).toBe("codex");
    expect(createSessionCalls[0]?.[2]).toBe("Commit");
    expect(createSessionCalls[0]?.[3]).toBe("Create commits for all changes, staged and unstaged.");
    expect(createSessionCalls[0]?.[5]).toBeUndefined();
});

test("an overridden built-in supplies agent, options and prompt", async () => {
    builtinList = [
        {
            ...BUILTIN_ACTION_DEFAULTS["builtin:commit"],
            prompt: "Be careful.\n{{instructions}}",
            sessionType: "claude",
            agentOptions: { type: "claude", model: "opus" },
            isModified: true,
        },
    ];
    await commitWithAgent();
    expect(createSessionCalls[0]?.[1]).toBe("claude");
    expect(createSessionCalls[0]?.[3]).toBe(
        "Be careful.\nCreate commits for all changes, staged and unstaged.",
    );
    expect(createSessionCalls[0]?.[5]).toEqual({ type: "claude", model: "opus" });
});

test("a machine without built-in actions falls back to the default", async () => {
    builtinList = new Error("No handler for message type: builtin-action:list");
    await commitWithAgent();
    expect(createSessionCalls).toHaveLength(1);
    expect(createSessionCalls[0]?.[1]).toBe("codex");
    expect(createSessionCalls[0]?.[3]).toBe("Create commits for all changes, staged and unstaged.");
});

test("any other lookup failure shows the error and starts no session", async () => {
    builtinList = new Error("Request timeout: builtin-action:list");
    await commitWithAgent();
    expect(createSessionCalls).toHaveLength(0);
    expect(document.body.textContent).toContain("Request timeout: builtin-action:list");
});
```

- [ ] **Step 2: Run the test and check that it fails**

Run: `bun test packages/ui/src/components/workspace/CommitDialog.test.tsx`
Expected: FAIL — `#commit-agent` still rendered, and no `BUILTIN_ACTIONS_LIST` request.

- [ ] **Step 3: Change `CommitDialog.tsx`**

1. Replace the imports block's shared imports with:

```ts
import type {
    BuiltinActionDefinition,
    BuiltinActionsListResponse,
    GitStatusResponse,
    GitCreatePrResult,
    GitCommitResult,
} from "@taskflow/shared";
import { BUILTIN_ACTION_DEFAULTS, MSG, renderPromptTemplate } from "@taskflow/shared";
```

   Delete these imports: `useAgentAvailability`/`isAgentAvailable`, the `Select*` block, the `Collapsible*` block, `AgentOptionsPanel` and `ChevronRight`.
2. Delete this state and these handlers: `agentType`, `agentOptions`, `agentOptionsOpen`, `agentOptionsKey`, `agents`, `handleAgentTypeChange`, `handleResetAgentOptions`, and their lines in `resetForm`. Keep `defaultAgent`: it's still used. `resetForm`'s dependency list becomes `[]`.
3. Add this helper above the component:

```ts
/**
 * The workspace machine's commit built-in, fetched fresh from that machine
 * (it may not be primary, whose store the Actions dialog manages). A machine
 * that predates built-in actions has no handler for the request; it gets the
 * default, which is what it ran before. Any other failure propagates, so a
 * transient error never silently replaces a configured override.
 */
async function loadCommitAction(
    request: <T>(type: string, payload?: unknown) => Promise<T>,
): Promise<BuiltinActionDefinition> {
    const fallback: BuiltinActionDefinition = {
        ...BUILTIN_ACTION_DEFAULTS["builtin:commit"],
        isModified: false,
    };
    try {
        const { actions } = await request<BuiltinActionsListResponse>(MSG.BUILTIN_ACTIONS_LIST);
        return actions.find((action) => action.id === "builtin:commit") ?? fallback;
    } catch (error) {
        // Router text for an unregistered type: packages/backend/src/ws/router.ts:18
        if (error instanceof Error && error.message.startsWith("No handler for message type")) {
            return fallback;
        }
        throw error;
    }
}
```

4. Replace the agent-mode block's `const prompt = parts.join(" ");` and the `createSession(...)` call with:

```ts
                const commitAction = await loadCommitAction(request);
                const prompt = renderPromptTemplate(commitAction.prompt, {
                    instructions: parts.join(" "),
                });
                // Options belong to the built-in's own agent; the default agent gets none.
                await createSession(
                    sessionOwner,
                    commitAction.sessionType ?? defaultAgent,
                    "Commit",
                    prompt,
                    undefined,
                    commitAction.sessionType ? commitAction.agentOptions : undefined,
                );
```

5. In `handleSubmit`'s dependency list, remove `agentType` and `agentOptions` and add `defaultAgent`.
6. In the JSX, replace the whole `{useAgent && ( <div className="ml-6 …"> … </div> )}` block with:

```tsx
                                {useAgent && (
                                    <p className="text-muted-foreground ml-6 text-xs">
                                        Configured in Actions and Flows → Built-in
                                    </p>
                                )}
```

If `loadCommitAction`'s `request` parameter type doesn't match `useWorkspaceRequest`'s return type, import and use the hook's exported type if there is one. Otherwise keep the inline signature shown, which matches `WorkspaceRequest` in `packages/ui/src/hooks/useWorkspaceRequest.ts:5`. Don't cast.

- [ ] **Step 4: Run the test and check that it passes**

Run: `bun test packages/ui/src/components/workspace/CommitDialog.test.tsx && bun run typecheck`
Expected: PASS; typecheck exits 0.

- [ ] **Step 5: Commit**

```bash
bunx prettier --write packages/ui/src/components/workspace/CommitDialog.tsx packages/ui/src/components/workspace/CommitDialog.test.tsx
git add packages/ui
git commit -m "feat(ui): commit dialog runs the built-in commit action"
```

---

### Task 8: Whole-branch verification

**Files:** none, unless a check fails.

- [ ] **Step 1: Static checks**

Run: `bun run typecheck && bun run lint && bunx prettier --check packages/shared packages/backend/src packages/backend/tests packages/ui/src`
Expected: all exit 0. Fix only what this branch introduced.

- [ ] **Step 2: Backend and shared suites**

Run: `bun test packages/shared packages/backend`
Expected: 0 failures.

- [ ] **Step 3: UI tests touched by this branch, one file per process**

```bash
for f in packages/ui/src/components/workspace/AgentOptionsPanel.test.tsx \
         packages/ui/src/components/shared/ClaudeOptions.headless.test.tsx \
         packages/ui/src/components/flows/BuiltinActionEditor.test.tsx \
         packages/ui/src/components/flows/FlowManagementDialog.builtin.test.tsx \
         packages/ui/src/components/flows/FlowEditor.library.test.tsx \
         packages/ui/src/components/flows/FlowEditor.loop.test.tsx \
         packages/ui/src/components/workspace/CommitDialog.test.tsx; do
  bun test "$f" || echo "FAILED: $f"
done
```

Expected: no `FAILED:` lines.

- [ ] **Step 4: Dead-code check**

Run: `grep -rn "headlessClaudeEnv\|snapshotAgentOptions" packages --include='*.ts' --include='*.tsx' | grep -v node_modules`
Expected: no output.

- [ ] **Step 5: Manual smoke test (orchestrator, not the implementer)**

Use a sandboxed dev backend. It must never run against the real data dir (see memory `project_dev_backend_sandbox`): `HOME=<scratch>/home TASKFLOW_DEV=1 TASKFLOW_DEV_PORT=18799 bun src/index.ts` from `packages/backend`, and `VITE_BACKEND_PORT=18799 bun run dev` in `packages/ui`. Then:
1. Open Actions and Flows, choose Built-in, and check that the four built-ins are listed.
2. Edit "Generate task title": set the agent to Codex and the model to `gpt-5.6-luna`, then save. The list shows "Modified" and `<HOME>/.config/taskflow/flows/builtin-actions.json` holds the override.
3. Create a task with a description and no title (seed via WS `task:create`). The title comes from Codex. Check with `ps` during the run, or the backend log.
4. Reset "Generate task title". The Modified marker goes and the file no longer lists it.
5. In the commit dialog, check that "Use agent" shows the hint and that no agent picker appears.

Record the results in the task log (`taskflow-cli log info`).

---

## Self-review notes (plan author)

- **Spec coverage:**

  | Spec section | Task |
  |---|---|
  | Catalogue and defaults | 1 |
  | Data model | 1 |
  | Storage | 3 |
  | WS messages | 3 |
  | Headless runner | 2 |
  | Env | 2, 4 |
  | Running a built-in and call sites | 4 |
  | Flow store | 5 |
  | Dialog | 6 |
  | Editor | 6 |
  | `headless` panel | 5 |
  | Commit dialog | 7 |
  | Error handling | 2, 3, 4, 7 |
  | Testing | every task |

- **Deviations from the spec, all deliberate:**
  - `BuiltinActionStore` became `createBuiltinActions`. The spec's own later revision uses that name, and persistence sits in `FlowStore`.
  - The commit dialog calls `BUILTIN_ACTIONS_LIST` directly through `useWorkspaceRequest` instead of going through the flow store. It always gets fresh data from the workspace's machine, which may not be primary, and it doesn't cache.
  - Schedule-name generation moved out of `index.ts` into `schedule-name.ts` so it can be tested.
  - A machine that predates built-ins falls back to the default commit action (Review Focus 2).
- **Type names used across tasks:** `BuiltinActions`, `BuiltinActionRunner`, `runHeadless`, `headlessAgentEnv`, `runHeadlessAgent`, `buildHeadlessCommand`, `agentOptionsSnapshot`, `builtinActionFollowsDefaultAgent`, `missingPromptVariables`, `renderPromptTemplate`.
