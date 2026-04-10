# Add Pi Agent Support Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add support for Pi (`@mariozechner/pi-coding-agent`, binary `pi`) as a first-class taskflow agent type, alongside Claude, Codex, OpenCode, Gemini, and Cursor.

**Architecture:** Pi plugs into the existing discriminated-union agent abstraction. The backend's central `buildAgentLaunchSpec` gets a new `"pi"` branch that assembles `pi --model ... --thinking ... --tools ... --append-system-prompt <taskflow-system-prompt> [prompt]`. The UI follows the same per-agent recipe used for Gemini/OpenCode: an async model dropdown (fed by `pi --list-models`), a per-session options panel mirroring the real CLI flags, and a settings section for defaults. Pi is integrated in its interactive TUI mode only.

**Tech Stack:** TypeScript, Bun, React, Electron. Shared package uses discriminated unions. UI uses shadcn/ui (`Select`, `Popover`, `Input`, `Switch`, `Label`, `SettingRow`).

**Reference spec:** `docs/superpowers/specs/2026-04-10-add-pi-agent-support-design.md`

---

## Task 1: Shared types, constants, and literal-union updates

Adds Pi to the shared type surface. Every downstream task depends on this — it must land first and typecheck clean.

**Files:**
- Modify: `packages/shared/src/types/agent.ts`
- Modify: `packages/shared/src/types/settings.ts`
- Modify: `packages/shared/src/types/ws.ts`
- Modify: `packages/shared/src/types/task.ts`
- Modify: `packages/shared/src/types/flow.ts`
- Modify: `packages/shared/src/constants.ts`

- [ ] **Step 1.1: Extend `AgentType` and add Pi types**

Replace the top of `packages/shared/src/types/agent.ts` (lines 1-11, and the type exports at the bottom) as follows. The rest of the file (ClaudeLaunchOptions, etc.) is unchanged.

Add to the union and arrays:

```ts
type AgentType = "claude" | "codex" | "opencode" | "gemini" | "cursor" | "pi";

const ALL_AGENT_TYPES: AgentType[] = [
    "claude",
    "codex",
    "opencode",
    "gemini",
    "cursor",
    "pi",
];

const AGENT_DISPLAY_NAMES: Record<AgentType, string> = {
    claude: "Claude",
    codex: "Codex",
    opencode: "OpenCode",
    gemini: "Gemini",
    cursor: "Cursor",
    pi: "Pi",
};
```

Then add the Pi-specific types anywhere after the `CursorLaunchOptions` interface (around line 65):

```ts
type PiThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh";

interface PiLaunchOptions {
    type: Extract<AgentType, "pi">;
    /** Assembled as `${provider}/${id}` — passed verbatim to `--model`. */
    model?: string;
    thinking?: PiThinkingLevel;
    /** Comma-separated tool list; empty/undefined omits the `--tools` flag. */
    tools?: string;
}

interface PiModelInfo {
    provider: string;
    id: string;
    /** Display-only string, e.g. "272K". */
    contextWindow: string;
    /** Display-only string, e.g. "128K". */
    maxOutput: string;
    supportsThinking: boolean;
    supportsImages: boolean;
}
```

Extend the `AgentLaunchOptions` union to include `PiLaunchOptions`:

```ts
type AgentLaunchOptions =
    | ClaudeLaunchOptions
    | CodexLaunchOptions
    | OpenCodeLaunchOptions
    | GeminiLaunchOptions
    | CursorLaunchOptions
    | PiLaunchOptions;
```

Update the bottom exports — add `PiThinkingLevel`, `PiLaunchOptions`, `PiModelInfo` to the type exports. Value exports are unchanged:

```ts
export { ALL_AGENT_TYPES, AGENT_DISPLAY_NAMES };

export type {
    AgentType,
    ClaudePermissionMode,
    ClaudeEffortLevel,
    ClaudeLaunchOptions,
    CodexLaunchOptions,
    CodexSandboxMode,
    CodexApprovalPolicy,
    OpenCodeLaunchOptions,
    GeminiLaunchOptions,
    CursorLaunchOptions,
    PiThinkingLevel,
    PiLaunchOptions,
    PiModelInfo,
    AgentLaunchOptions,
    AgentAvailability,
    OpenCodeModelInfo,
};
```

- [ ] **Step 1.2: Add `PiSettings` and extend `AppSettings` / `SettingsUpdatePayload`**

In `packages/shared/src/types/settings.ts`, update the top import to include `PiThinkingLevel`:

```ts
import type {
    AgentType,
    ClaudePermissionMode,
    ClaudeEffortLevel,
    CodexSandboxMode,
    CodexApprovalPolicy,
    PiThinkingLevel,
} from "./agent";
```

Add the `PiSettings` interface after `CursorSettings` (around line 46):

```ts
export interface PiSettings {
    defaultModel: string;
    thinking: PiThinkingLevel;
    tools: string;
}
```

Add `pi: PiSettings;` to `AppSettings` (inside the interface around line 106, right after `cursor`):

```ts
export interface AppSettings {
    general: GeneralSettings;
    terminal: TerminalSettings;
    editor: EditorSettings;
    layout: LayoutSettings;
    claude: ClaudeSettings;
    codex: CodexSettings;
    opencode: OpenCodeSettings;
    gemini: GeminiSettings;
    cursor: CursorSettings;
    pi: PiSettings;
    appearance: AppearanceSettings;
    remoteAgent: RemoteAgentSettings;
}
```

Add `pi?: NullablePartial<PiSettings>;` to `SettingsUpdatePayload` (around line 125, right after `cursor`):

```ts
export interface SettingsUpdatePayload {
    general?: NullablePartial<GeneralSettings>;
    terminal?: NullablePartial<TerminalSettings>;
    editor?: NullablePartial<EditorSettings>;
    layout?: {
        window?: NullablePartial<WindowSettings>;
        panels?: NullablePartial<PanelSettings>;
    };
    claude?: NullablePartial<ClaudeSettings>;
    codex?: NullablePartial<CodexSettings>;
    opencode?: NullablePartial<OpenCodeSettings>;
    gemini?: NullablePartial<GeminiSettings>;
    cursor?: NullablePartial<CursorSettings>;
    pi?: NullablePartial<PiSettings>;
    appearance?: NullablePartial<AppearanceSettings>;
    remoteAgent?: NullablePartial<RemoteAgentSettings>;
}
```

- [ ] **Step 1.3: Add `PiModelsResponse` and update `SessionCreatePayload`**

In `packages/shared/src/types/ws.ts`:

1. Update the import at line 7 to include `PiModelInfo`:

```ts
import type {
    AgentLaunchOptions,
    AgentAvailability,
    OpenCodeModelInfo,
    PiModelInfo,
} from "./agent";
```

2. Update `SessionCreatePayload.type` at line 125 to include `"pi"`:

```ts
    type: "claude" | "codex" | "opencode" | "gemini" | "cursor" | "pi" | "shell" | "editor";
```

3. Add `PiModelsResponse` right after `OpenCodeModelsResponse` (around line 238):

```ts
export interface PiModelsResponse {
    models: PiModelInfo[];
}
```

- [ ] **Step 1.4: Update `SessionRef.type` literal union**

In `packages/shared/src/types/task.ts` line 5, extend the literal union:

```ts
    type: "claude" | "codex" | "opencode" | "gemini" | "cursor" | "pi" | "shell" | "editor";
```

- [ ] **Step 1.5: Update `SessionType` in flow types**

In `packages/shared/src/types/flow.ts` line 3, extend the literal union:

```ts
type SessionType = "claude" | "codex" | "opencode" | "gemini" | "cursor" | "pi" | "shell";
```

- [ ] **Step 1.6: Add `PI_MODELS` constant**

In `packages/shared/src/constants.ts`, add `PI_MODELS: "pi:models",` to the `MSG` object right after `OPENCODE_MODELS` (line 39):

```ts
    CURSOR_MODELS: "cursor:models",
    OPENCODE_MODELS: "opencode:models",
    PI_MODELS: "pi:models",
```

- [ ] **Step 1.7: Typecheck shared package**

Run from the worktree root:

```bash
bun run --filter @taskflow/shared typecheck
```

Expected: clean exit (no TypeScript errors in `packages/shared`). The backend and UI packages will fail typecheck at this point — that's expected; later tasks fix those. If the shared package itself has errors, fix them before committing.

- [ ] **Step 1.8: Commit**

```bash
git add packages/shared/src/types/agent.ts packages/shared/src/types/settings.ts packages/shared/src/types/ws.ts packages/shared/src/types/task.ts packages/shared/src/types/flow.ts packages/shared/src/constants.ts
git commit -m "feat(shared): add Pi agent types and constants"
```

---

## Task 2: Backend model list fetch (TDD)

Adds the `fetchPiModels` implementation, with the parser extracted as a pure function for unit testing. Also registers `"pi"` in `KNOWN_AGENTS` and wires the `PI_MODELS` IPC handler.

**Files:**
- Modify: `packages/backend/src/services/runtime-detector.ts`
- Modify: `packages/backend/src/index.ts`
- Test: `packages/backend/tests/services/runtime-detector.test.ts`

- [ ] **Step 2.1: Write the failing parser test**

Open `packages/backend/tests/services/runtime-detector.test.ts`. Add the following `describe` block at the bottom of the file (after `describe("detectAgents", …)`), and update the top import to add `parsePiModelsOutput`:

Top of file — update the import:

```ts
import { describe, it, expect } from "bun:test";
import {
    detectRuntimes,
    detectAgents,
    parsePiModelsOutput,
} from "../../src/services/runtime-detector";
```

Append at the bottom:

```ts
describe("parsePiModelsOutput", () => {
    const FIXTURE = [
        "provider      model                context  max-out  thinking  images",
        "openai-codex  gpt-5.1              272K     128K     yes       yes   ",
        "openai-codex  gpt-5.3-codex-spark  128K     128K     yes       no    ",
        "anthropic     claude-sonnet-4.5    200K     64K      no        yes   ",
    ].join("\n");

    it("parses columns into PiModelInfo objects and skips the header", () => {
        const models = parsePiModelsOutput(FIXTURE);
        expect(models).toHaveLength(3);
        expect(models[0]).toEqual({
            provider: "openai-codex",
            id: "gpt-5.1",
            contextWindow: "272K",
            maxOutput: "128K",
            supportsThinking: true,
            supportsImages: true,
        });
    });

    it("converts yes/no columns to booleans", () => {
        const models = parsePiModelsOutput(FIXTURE);
        expect(models[1].supportsThinking).toBe(true);
        expect(models[1].supportsImages).toBe(false);
        expect(models[2].supportsThinking).toBe(false);
        expect(models[2].supportsImages).toBe(true);
    });

    it("returns empty array for empty input", () => {
        expect(parsePiModelsOutput("")).toEqual([]);
        expect(parsePiModelsOutput("   \n   ")).toEqual([]);
    });

    it("returns empty array for header-only input", () => {
        expect(
            parsePiModelsOutput(
                "provider  model  context  max-out  thinking  images",
            ),
        ).toEqual([]);
    });
});
```

- [ ] **Step 2.2: Run the test to confirm it fails**

```bash
bun test packages/backend/tests/services/runtime-detector.test.ts
```

Expected: test run fails with an import error — `parsePiModelsOutput` is not exported from `runtime-detector.ts`. Confirms the test is actually exercising the symbol we're about to add.

- [ ] **Step 2.3: Add `"pi"` to `KNOWN_AGENTS`, add `parsePiModelsOutput` and `fetchPiModels`**

In `packages/backend/src/services/runtime-detector.ts`:

1. Update the import at the top to add `PiModelInfo`:

```ts
import type {
    RuntimeInfo,
    AgentAvailability,
    AgentType,
    CursorModel,
    OpenCodeModelInfo,
    PiModelInfo,
} from "@taskflow/shared";
```

2. Replace `KNOWN_AGENTS` at line 41:

```ts
const KNOWN_AGENTS: AgentType[] = ["claude", "codex", "opencode", "gemini", "cursor", "pi"];
```

3. Append these two new functions at the very bottom of the file, after `fetchOpenCodeModels`:

```ts
export function parsePiModelsOutput(output: string): PiModelInfo[] {
    const lines = output
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean);
    if (lines.length < 2) return [];
    // Skip the header row: "provider  model  context  max-out  thinking  images".
    return lines
        .slice(1)
        .map((line) => {
            const cols = line.split(/\s{2,}/);
            const [provider, id, contextWindow, maxOutput, thinking, images] = cols;
            return {
                provider: provider ?? "",
                id: id ?? "",
                contextWindow: contextWindow ?? "",
                maxOutput: maxOutput ?? "",
                supportsThinking: thinking === "yes",
                supportsImages: images === "yes",
            };
        })
        .filter((m) => m.provider && m.id);
}

export async function fetchPiModels(): Promise<PiModelInfo[]> {
    const output = await runCliCommand("pi", ["--list-models"]);
    return parsePiModelsOutput(output);
}
```

- [ ] **Step 2.4: Run the parser tests to confirm they pass**

```bash
bun test packages/backend/tests/services/runtime-detector.test.ts
```

Expected: all four `parsePiModelsOutput` tests pass. `detectRuntimes` and `detectAgents` tests continue to pass. `detectAgents` may now include an entry for `"pi"` depending on whether `pi` is on the test machine's PATH — that is fine; the existing assertions only check for `claude` / `codex`.

- [ ] **Step 2.5: Register the `PI_MODELS` IPC handler**

In `packages/backend/src/index.ts`:

1. Update the import around line 12-17 to add `fetchPiModels`:

```ts
import {
    detectRuntimes,
    detectAgents,
    fetchCursorModels,
    fetchOpenCodeModels,
    fetchPiModels,
} from "./services/runtime-detector";
```

2. Register a new handler right after the `OPENCODE_MODELS` handler (around line 397):

```ts
        router.register(MSG.OPENCODE_MODELS, async () => ({
            models: await fetchOpenCodeModels(),
        }));
        router.register(MSG.PI_MODELS, async () => ({
            models: await fetchPiModels(),
        }));
```

- [ ] **Step 2.6: Typecheck backend**

```bash
bun run --filter @taskflow/backend typecheck
```

Expected: typecheck may still fail because of yet-to-be-added `"pi"` cases in `buildAgentLaunchSpec` and `settingsToAgentOptions` (Task 3). That's fine — confirm the errors are only about those two surfaces and not about the runtime-detector changes.

- [ ] **Step 2.7: Commit**

```bash
git add packages/backend/src/services/runtime-detector.ts packages/backend/src/index.ts packages/backend/tests/services/runtime-detector.test.ts
git commit -m "feat(backend): fetch and parse Pi model list"
```

---

## Task 3: Backend session spawning and lifecycle

Adds the `"pi"` branch to `buildAgentLaunchSpec` and wires `"pi"` through `session-lifecycle.ts`. After this task, the backend package should typecheck clean.

**Files:**
- Modify: `packages/backend/src/services/internal-agent-skill.ts`
- Modify: `packages/backend/src/services/session-lifecycle.ts`

- [ ] **Step 3.1: Extend `buildAgentLaunchSpec` type parameter and add the `"pi"` branch**

In `packages/backend/src/services/internal-agent-skill.ts`:

1. Update line 177 to add `"pi"` to the type parameter:

```ts
export function buildAgentLaunchSpec(
    type: "claude" | "codex" | "opencode" | "gemini" | "cursor" | "pi",
    prompt: string | undefined,
    skillPath: string,
    agentOptions?: AgentLaunchOptions,
    additionalSystemPrompt?: string,
    isProjectScope?: boolean,
    isFlowScope?: boolean,
): { command: string; args: string[]; env?: Record<string, string> } {
```

2. Insert a new `"pi"` branch right after the `"cursor"` branch (around line 262, before the final Codex branch). The Codex branch is the fallback / default since it has no `if (type === "codex")` guard — so the Pi branch must `return` explicitly:

```ts
    if (type === "pi") {
        const optionArgs: string[] = [];
        if (agentOptions?.type === "pi") {
            if (agentOptions.model) optionArgs.push("--model", agentOptions.model);
            if (agentOptions.thinking && agentOptions.thinking !== "off")
                optionArgs.push("--thinking", agentOptions.thinking);
            if (agentOptions.tools?.trim())
                optionArgs.push("--tools", agentOptions.tools.trim());
        }
        return {
            command: "pi",
            args: [
                ...optionArgs,
                "--append-system-prompt",
                systemPrompt,
                ...(prompt ? [prompt] : []),
            ],
        };
    }
```

Note: `skillPath` is intentionally unused here. Pi has a native `--skill` flag, but the skill content is already inlined inside `systemPrompt` via `buildSystemPrompt()` (lines 62-69), and using both would duplicate the skill text. Pi's built-in `read` tool lets the agent open the skill's split command files on demand via the absolute paths baked into the prompt.

- [ ] **Step 3.2: Add `"pi"` to `CreateSessionOpts.type`**

In `packages/backend/src/services/session-lifecycle.ts` line 37:

```ts
    type: "claude" | "codex" | "opencode" | "gemini" | "cursor" | "pi" | "shell" | "editor";
```

- [ ] **Step 3.3: Add `"pi"` case to `settingsToAgentOptions`**

In `packages/backend/src/services/session-lifecycle.ts`, inside the `settingsToAgentOptions` switch (around line 125-132), add a new case right after `"cursor"`:

```ts
        case "cursor": {
            const s = settings.cursor;
            return {
                type: "cursor",
                model: s.defaultModel === "default" ? undefined : s.defaultModel || undefined,
                yolo: s.yolo || undefined,
            };
        }
        case "pi": {
            const s = settings.pi;
            return {
                type: "pi",
                model: s.defaultModel || undefined,
                thinking: s.thinking === "off" ? undefined : s.thinking,
                tools: s.tools || undefined,
            };
        }
```

- [ ] **Step 3.4: Add `"pi"` label to `getDefaultSessionLabel`**

In `packages/backend/src/services/session-lifecycle.ts` at `getDefaultSessionLabel` (around line 136), add a line after `cursor`:

```ts
function getDefaultSessionLabel(type: CreateSessionOpts["type"]): string {
    if (type === "claude") return "Claude";
    if (type === "codex") return "Codex";
    if (type === "opencode") return "OpenCode";
    if (type === "gemini") return "Gemini";
    if (type === "cursor") return "Cursor";
    if (type === "pi") return "Pi";
    if (type === "editor") return "Editor";
    return `${type} session`;
}
```

- [ ] **Step 3.5: Add default `PiSettings` to the settings store**

All four edits below land in `packages/backend/src/services/settings-store.ts`. Each mirrors the existing `cursor` entry one-for-one.

1. In the `DEFAULTS` object (around line 74-77), add a `pi` entry right after `cursor`:

```ts
    cursor: {
        defaultModel: "default",
        yolo: false,
    },
    pi: {
        defaultModel: "",
        thinking: "off",
        tools: "read,bash,edit,write,grep,find,ls",
    },
```

2. In `createDefaultSettings()` (around line 101), add the matching copy line right after `cursor`:

```ts
        cursor: { ...DEFAULTS.cursor },
        pi: { ...DEFAULTS.pi },
```

3. In the `get()` merge block (around line 153), add the matching merge line right after `cursor`:

```ts
                cursor: { ...defaults.cursor, ...parsed.cursor },
                pi: { ...defaults.pi, ...parsed.pi },
```

4. In the `update()` method (around line 198-200), add the matching `applyNullable` call right after `cursor`:

```ts
        if (partial.cursor) {
            applyNullable(current.cursor, partial.cursor);
        }
        if (partial.pi) {
            applyNullable(current.pi, partial.pi);
        }
```

- [ ] **Step 3.6: Typecheck backend**

```bash
bun run --filter @taskflow/backend typecheck
```

Expected: clean exit. All backend typechecks pass. If any case is missing (e.g. an exhaustive switch elsewhere in the backend), add the `"pi"` case with the analogous behavior and rerun.

- [ ] **Step 3.7: Commit**

```bash
git add packages/backend/src/services/internal-agent-skill.ts packages/backend/src/services/session-lifecycle.ts packages/backend/src/services/settings-store.ts
git commit -m "feat(backend): spawn Pi sessions via buildAgentLaunchSpec"
```

If step 3.5 modified a different file, adjust the `git add` path accordingly.

---

## Task 4: UI — Pi icon and tab metadata

Adds the Pi icon component and registers it in the tab metadata map so downstream UI tasks can reference it.

**Files:**
- Create: `packages/ui/src/components/icons/PiIcon.tsx`
- Modify: `packages/ui/src/components/workspace/tab-constants.ts`

- [ ] **Step 4.1: Create `PiIcon.tsx`**

Write `packages/ui/src/components/icons/PiIcon.tsx`:

```tsx
import type { SVGProps } from "react";

function PiIcon(props: SVGProps<SVGSVGElement>) {
    return (
        <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            xmlns="http://www.w3.org/2000/svg"
            {...props}>
            <path d="M4 7h16" />
            <path d="M9 7v11a1 1 0 0 1-1 1H7" />
            <path d="M16 7v9a2 2 0 0 0 2 2h1" />
        </svg>
    );
}

export { PiIcon };
```

This is a simple stylized `π` glyph: a top crossbar plus two descending legs, matching the stroke-based style used by the Lucide icon family already used elsewhere in the UI.

- [ ] **Step 4.2: Register `PiIcon` in `tab-constants.ts`**

In `packages/ui/src/components/workspace/tab-constants.ts`:

1. Add the import at the top, right after `CursorIcon`:

```ts
import { CursorIcon } from "@/components/icons/CursorIcon";
import { PiIcon } from "@/components/icons/PiIcon";
```

2. Add a `pi` entry to `AGENT_META` (right after `cursor`):

```ts
const AGENT_META: Record<
    AgentType,
    {
        icon: (props: { className?: string }) => React.ReactNode;
        colorClass: string;
    }
> = {
    claude: { icon: ClaudeIcon, colorClass: "text-warning" },
    codex: { icon: CodexIcon, colorClass: "text-success" },
    opencode: { icon: OpenCodeIcon, colorClass: "text-opencode" },
    gemini: { icon: GeminiIcon, colorClass: "text-primary" },
    cursor: { icon: CursorIcon, colorClass: "text-cursor-agent" },
    pi: { icon: PiIcon, colorClass: "text-primary" },
};
```

3. Add a `pi` variant to `tabVariants` (right after `cursor`):

```ts
const tabVariants = cva(
    "px-1.5 h-6 shrink-0 rounded-md cursor-pointer flex items-center gap-1 text-sm whitespace-nowrap transition-colors",
    {
        variants: {
            type: {
                claude: "text-warning",
                codex: "text-success",
                opencode: "text-opencode",
                gemini: "text-primary",
                cursor: "text-cursor-agent",
                pi: "text-primary",
                shell: "text-info",
                editor: "text-muted-foreground",
                changes: "text-muted-foreground",
                browser: "text-muted-foreground",
                markdown: "text-muted-foreground",
            },
            active: { true: "bg-muted", false: "bg-transparent hover:bg-muted/50" },
        },
        defaultVariants: { type: "editor", active: false },
    },
);
```

- [ ] **Step 4.3: Commit**

```bash
git add packages/ui/src/components/icons/PiIcon.tsx packages/ui/src/components/workspace/tab-constants.ts
git commit -m "feat(ui): add Pi agent icon and tab metadata"
```

Typecheck is deferred until Task 8 — UI intermediate files won't compile until all pieces are in place. That is expected and fine.

---

## Task 5: UI — `PiModelSelect` component

Creates the async model dropdown. Mirrors `OpenCodeModelSelect.tsx` but renders richer per-row metadata (provider, id, context window, capability badges).

**Files:**
- Create: `packages/ui/src/components/settings/PiModelSelect.tsx`

- [ ] **Step 5.1: Create `PiModelSelect.tsx`**

Write `packages/ui/src/components/settings/PiModelSelect.tsx`:

```tsx
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ChevronDownIcon } from "lucide-react";
import { sendRequest } from "@/hooks/useWebSocket";
import { MSG } from "@taskflow/shared";
import type { PiModelInfo, PiModelsResponse } from "@taskflow/shared";

interface PiModelSelectProps {
    value: string;
    onChange: (model: string) => void;
}

function modelKey(m: PiModelInfo): string {
    return `${m.provider}/${m.id}`;
}

function PiModelSelect({ value, onChange }: PiModelSelectProps) {
    const [open, setOpen] = useState(false);
    const [models, setModels] = useState<PiModelInfo[] | null>(null);
    const [search, setSearch] = useState("");
    const [fetchFailed, setFetchFailed] = useState(false);
    const [portalContainer, setPortalContainer] = useState<HTMLElement | null>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const searchRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        if (!open || models !== null || fetchFailed) return;
        sendRequest<PiModelsResponse>(MSG.PI_MODELS, {})
            .then((res) => {
                setModels(res.models);
            })
            .catch(() => {
                setFetchFailed(true);
            });
    }, [open, models, fetchFailed]);

    useEffect(() => {
        setPortalContainer(
            containerRef.current?.closest<HTMLElement>("[data-slot='dialog-content']") ?? null,
        );
    }, []);

    const handleOpenChange = useCallback((nextOpen: boolean) => {
        if (nextOpen) {
            setSearch("");
            requestAnimationFrame(() => searchRef.current?.focus());
        }
        setOpen(nextOpen);
    }, []);

    const filtered = useMemo(() => {
        if (!models) return [];
        if (!search) return models;
        const lower = search.toLowerCase();
        return models.filter(
            (m) =>
                modelKey(m).toLowerCase().includes(lower) ||
                m.provider.toLowerCase().includes(lower),
        );
    }, [models, search]);

    const handleSelect = useCallback(
        (key: string) => {
            onChange(key);
            setOpen(false);
        },
        [onChange],
    );

    const handleKeyDown = useCallback(
        (e: React.KeyboardEvent) => {
            if (e.key === "Enter" && search) {
                onChange(search);
                setOpen(false);
            }
        },
        [search, onChange],
    );

    const displayLabel = useMemo(() => {
        if (!value) return null;
        const match = models?.find((m) => modelKey(m) === value);
        return match ? modelKey(match) : value;
    }, [value, models]);

    if (fetchFailed) {
        return (
            <Input
                value={value}
                placeholder="e.g. anthropic/claude-sonnet-4.5"
                onChange={(e) => onChange(e.target.value)}
                size="sm"
                className="text-[13px]"
            />
        );
    }

    return (
        <div ref={containerRef} className="min-w-0">
            <Popover open={open} onOpenChange={handleOpenChange}>
                <PopoverTrigger asChild>
                    <Button
                        variant="outline"
                        size="sm"
                        className="w-full min-w-0 justify-between overflow-hidden text-[13px] font-normal">
                        <span className="min-w-0 flex-1 truncate text-left">
                            {displayLabel || "Select model..."}
                        </span>
                        <ChevronDownIcon className="ml-2 size-4 shrink-0 opacity-50" />
                    </Button>
                </PopoverTrigger>
                <PopoverContent
                    container={portalContainer ?? undefined}
                    className="w-[--radix-popover-trigger-width] min-w-80 p-0"
                    align="start">
                    <div className="border-border border-b p-2">
                        <Input
                            ref={searchRef}
                            placeholder="Search models... (Enter for custom)"
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            onKeyDown={handleKeyDown}
                            className="h-7 text-sm"
                        />
                    </div>
                    <div className="max-h-60 overflow-y-auto p-1">
                        {models === null ? (
                            <div className="text-muted-foreground px-2 py-4 text-center text-sm">
                                Loading models...
                            </div>
                        ) : models.length === 0 ? (
                            <div className="text-muted-foreground px-2 py-4 text-center text-sm">
                                No models available
                            </div>
                        ) : filtered.length === 0 ? (
                            <div className="text-muted-foreground px-2 py-4 text-center text-sm">
                                No matches — press Enter to use custom value
                            </div>
                        ) : (
                            filtered.map((m) => {
                                const key = modelKey(m);
                                const badges: string[] = [`${m.contextWindow} ctx`];
                                if (m.supportsThinking) badges.push("thinking");
                                if (m.supportsImages) badges.push("images");
                                return (
                                    <button
                                        key={key}
                                        type="button"
                                        className={`hover:bg-accent hover:text-accent-foreground flex w-full cursor-default flex-col items-start gap-0.5 rounded-sm px-2 py-1.5 text-left text-sm outline-hidden ${
                                            key === value ? "bg-accent text-accent-foreground" : ""
                                        }`}
                                        onClick={() => handleSelect(key)}>
                                        <span className="truncate">{key}</span>
                                        <span className="text-muted-foreground truncate text-[11px]">
                                            {badges.join(" · ")}
                                        </span>
                                    </button>
                                );
                            })
                        )}
                    </div>
                </PopoverContent>
            </Popover>
        </div>
    );
}

export { PiModelSelect };
```

- [ ] **Step 5.2: Commit**

```bash
git add packages/ui/src/components/settings/PiModelSelect.tsx
git commit -m "feat(ui): add PiModelSelect dropdown"
```

---

## Task 6: UI — `PiOptions` component and `AgentOptionsPanel` integration

Creates the shared per-session options panel for Pi and wires it into `AgentOptionsPanel` so sessions can render it.

**Files:**
- Create: `packages/ui/src/components/shared/PiOptions.tsx`
- Modify: `packages/ui/src/components/workspace/AgentOptionsPanel.tsx`

- [ ] **Step 6.1: Create `PiOptions.tsx`**

Write `packages/ui/src/components/shared/PiOptions.tsx`:

```tsx
import { Input } from "@/components/ui/input";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { PiModelSelect } from "@/components/settings/PiModelSelect";
import { SettingRow } from "@/components/settings/sections/SettingRow";
import type { PiThinkingLevel } from "@taskflow/shared";

interface PiOptionsProps {
    modelValue: string;
    thinkingValue: PiThinkingLevel;
    toolsValue: string;
    onModelChange: (value: string) => void;
    onThinkingChange: (value: PiThinkingLevel) => void;
    onToolsChange: (value: string) => void;
    /** "defaults" shows "Default Model" etc. "session" shows "Model" etc. */
    mode?: "defaults" | "session";
}

const LABELS = {
    defaults: {
        model: "Default Model",
        modelHint: "Pre-selected model when running Pi sessions",
        thinking: "Default Thinking",
        thinkingHint: "Default reasoning level for supported models",
        tools: "Default Tools",
        toolsHint: "Comma-separated list of built-in tools to enable",
    },
    session: {
        model: "Model",
        modelHint: "Model for Pi session (--model)",
        thinking: "Thinking",
        thinkingHint: "Reasoning level (--thinking)",
        tools: "Tools",
        toolsHint: "Comma-separated list of built-in tools (--tools)",
    },
};

const THINKING_OPTIONS: PiThinkingLevel[] = [
    "off",
    "minimal",
    "low",
    "medium",
    "high",
    "xhigh",
];

function PiOptions({
    modelValue,
    thinkingValue,
    toolsValue,
    onModelChange,
    onThinkingChange,
    onToolsChange,
    mode = "session",
}: PiOptionsProps) {
    const l = LABELS[mode];

    return (
        <>
            <SettingRow label={l.model} hint={l.modelHint}>
                <PiModelSelect value={modelValue} onChange={onModelChange} />
            </SettingRow>
            <SettingRow label={l.thinking} hint={l.thinkingHint}>
                <Select
                    value={thinkingValue}
                    onValueChange={(v) => onThinkingChange(v as PiThinkingLevel)}>
                    <SelectTrigger size="sm" className="w-[180px] text-[13px]">
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        {THINKING_OPTIONS.map((level) => (
                            <SelectItem key={level} value={level}>
                                {level === "off" ? "Off" : level.charAt(0).toUpperCase() + level.slice(1)}
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>
            </SettingRow>
            <SettingRow label={l.tools} hint={l.toolsHint}>
                <Input
                    size="sm"
                    className="text-[13px]"
                    placeholder="read,bash,edit,write,grep,find,ls"
                    value={toolsValue}
                    onChange={(e) => onToolsChange(e.target.value)}
                />
            </SettingRow>
        </>
    );
}

export { PiOptions };
```

- [ ] **Step 6.2: Wire `PiOptions` into `AgentOptionsPanel`**

In `packages/ui/src/components/workspace/AgentOptionsPanel.tsx`:

1. Extend the top-of-file import to add `PiThinkingLevel`:

```ts
import type {
    AgentLaunchOptions,
    AgentType,
    ClaudePermissionMode,
    ClaudeEffortLevel,
    CodexSandboxMode,
    CodexApprovalPolicy,
    GeminiLaunchOptions,
    PiThinkingLevel,
} from "@taskflow/shared";
```

2. Add the component import next to the other agent options imports:

```ts
import { OpenCodeOptions } from "@/components/shared/OpenCodeOptions";
import { PiOptions } from "@/components/shared/PiOptions";
```

3. Add `piSettings` to the settings selector block (after `cursorSettings`, around line 41):

```ts
    const cursorSettings = useSettingsStore((s) => s.settings?.cursor);
    const piSettings = useSettingsStore((s) => s.settings?.pi);
```

4. Add Pi defaults after the Cursor defaults block (around line 112). Insert these blocks before the "Model defaults (shared across agents)" section:

```ts
    // --- Pi-specific defaults ---
    const defaultPiThinking: PiThinkingLevel =
        matchingValue?.type === "pi"
            ? ((matchingValue.thinking ?? piSettings?.thinking ?? "off") as PiThinkingLevel)
            : ((piSettings?.thinking ?? "off") as PiThinkingLevel);
    const defaultPiTools =
        matchingValue?.type === "pi"
            ? (matchingValue.tools ?? piSettings?.tools ?? "")
            : (piSettings?.tools ?? "");
```

5. Extend the shared-model default ladder to include a Pi clause. Replace the `defaultModel` const (lines 114-135) with the version below — the change is the two new `agentType === "pi"` clauses at the appropriate depths:

```ts
    // --- Model defaults (shared across agents) ---
    const defaultModel =
        agentType === "codex" && matchingValue?.type === "codex"
            ? (matchingValue.model ?? codexSettings?.defaultModel ?? "")
            : agentType === "claude" && matchingValue?.type === "claude"
              ? (matchingValue.model ?? claudeSettings?.defaultModel ?? "default")
              : agentType === "opencode" && matchingValue?.type === "opencode"
                ? (matchingValue.model ?? opencodeSettings?.defaultModel ?? "")
                : agentType === "gemini" && matchingValue?.type === "gemini"
                  ? (matchingValue.model ?? geminiSettings?.defaultModel ?? "")
                  : agentType === "cursor" && matchingValue?.type === "cursor"
                    ? (matchingValue.model ?? cursorSettings?.defaultModel ?? "default")
                    : agentType === "pi" && matchingValue?.type === "pi"
                      ? (matchingValue.model ?? piSettings?.defaultModel ?? "")
                      : agentType === "codex"
                        ? (codexSettings?.defaultModel ?? "")
                        : agentType === "claude"
                          ? (claudeSettings?.defaultModel ?? "default")
                          : agentType === "opencode"
                            ? (opencodeSettings?.defaultModel ?? "")
                            : agentType === "gemini"
                              ? (geminiSettings?.defaultModel ?? "")
                              : agentType === "cursor"
                                ? (cursorSettings?.defaultModel ?? "default")
                                : agentType === "pi"
                                  ? (piSettings?.defaultModel ?? "")
                                  : "default";
```

6. Add state hooks right after the existing ones (around line 152):

```ts
    const [model, setModel] = useState<string>(defaultModel);
    const [piThinking, setPiThinking] = useState<PiThinkingLevel>(defaultPiThinking);
    const [piTools, setPiTools] = useState<string>(defaultPiTools);
```

7. Add a Pi branch to the `useEffect` that resets state when `agentType` changes (around line 162-183):

```ts
    useEffect(() => {
        if (agentType === "claude") {
            setDangerouslySkipPermissions(defaultDangerouslySkipPermissions);
            setPermissionMode(defaultPermissionMode);
            setEffort(defaultEffort);
            setModel(defaultModel);
        } else if (agentType === "codex") {
            setFullAuto(defaultFullAuto);
            setCodexSandbox(defaultCodexSandbox);
            setApprovalPolicy(defaultApprovalPolicy);
            setModel(defaultModel);
        } else if (agentType === "opencode") {
            setOcVariant(defaultOcVariant);
            setOcAutoApprove(defaultOcAutoApprove);
            setModel(defaultModel);
        } else if (agentType === "gemini") {
            setApprovalMode(defaultApprovalMode);
            setGeminiSandbox(defaultGeminiSandbox);
            setModel(defaultModel);
        } else if (agentType === "cursor") {
            setYolo(defaultYolo);
            setModel(defaultModel);
        } else if (agentType === "pi") {
            setPiThinking(defaultPiThinking);
            setPiTools(defaultPiTools);
            setModel(defaultModel);
        }
    }, [
        agentType,
        defaultDangerouslySkipPermissions,
        defaultPermissionMode,
        defaultEffort,
        defaultFullAuto,
        defaultCodexSandbox,
        defaultApprovalPolicy,
        defaultOcVariant,
        defaultOcAutoApprove,
        defaultApprovalMode,
        defaultGeminiSandbox,
        defaultYolo,
        defaultPiThinking,
        defaultPiTools,
        defaultModel,
    ]);
```

8. Add a `buildPiOptions` callback right after `buildCursorOptions` (around line 250):

```ts
    const buildPiOptions = useCallback(
        (): AgentLaunchOptions => ({
            type: "pi",
            model: model || undefined,
            thinking: piThinking === "off" ? undefined : piThinking,
            tools: piTools.trim() || undefined,
        }),
        [model, piThinking, piTools],
    );
```

9. Update the `buildOptions` switch (around line 252) to include Pi:

```ts
    const buildOptions = useCallback((): AgentLaunchOptions => {
        if (agentType === "claude") return buildClaudeOptions();
        if (agentType === "codex") return buildCodexOptions();
        if (agentType === "opencode") return buildOpenCodeOptions();
        if (agentType === "gemini") return buildGeminiOptions();
        if (agentType === "cursor") return buildCursorOptions();
        if (agentType === "pi") return buildPiOptions();
        return { type: "codex" };
    }, [
        agentType,
        buildClaudeOptions,
        buildCodexOptions,
        buildOpenCodeOptions,
        buildGeminiOptions,
        buildCursorOptions,
        buildPiOptions,
    ]);
```

10. Add the `PiOptions` render branch (around line 331, right after the Cursor branch, before the closing `: null`):

```tsx
            ) : agentType === "cursor" ? (
                <CursorOptions
                    modelValue={model}
                    yolo={yolo}
                    onModelChange={setModel}
                    onYoloChange={setYolo}
                />
            ) : agentType === "pi" ? (
                <PiOptions
                    modelValue={model}
                    thinkingValue={piThinking}
                    toolsValue={piTools}
                    onModelChange={setModel}
                    onThinkingChange={setPiThinking}
                    onToolsChange={setPiTools}
                />
            ) : null}
```

- [ ] **Step 6.3: Commit**

```bash
git add packages/ui/src/components/shared/PiOptions.tsx packages/ui/src/components/workspace/AgentOptionsPanel.tsx
git commit -m "feat(ui): render Pi options in AgentOptionsPanel"
```

---

## Task 7: UI — `PiSection` and `SettingsModal` registration

Creates the Pi settings tab inside the Settings modal.

**Files:**
- Create: `packages/ui/src/components/settings/sections/PiSection.tsx`
- Modify: `packages/ui/src/components/settings/SettingsModal.tsx`

- [ ] **Step 7.1: Create `PiSection.tsx`**

Write `packages/ui/src/components/settings/sections/PiSection.tsx`:

```tsx
import { PiOptions } from "@/components/shared/PiOptions";
import type { PiThinkingLevel } from "@taskflow/shared";

interface PiSectionProps {
    defaultModel: string;
    thinking: PiThinkingLevel;
    tools: string;
    onModelChange: (value: string) => void;
    onThinkingChange: (value: PiThinkingLevel) => void;
    onToolsChange: (value: string) => void;
}

function PiSection({
    defaultModel,
    thinking,
    tools,
    onModelChange,
    onThinkingChange,
    onToolsChange,
}: PiSectionProps) {
    return (
        <PiOptions
            mode="defaults"
            modelValue={defaultModel}
            thinkingValue={thinking}
            toolsValue={tools}
            onModelChange={onModelChange}
            onThinkingChange={onThinkingChange}
            onToolsChange={onToolsChange}
        />
    );
}

export { PiSection };
```

- [ ] **Step 7.2: Register the Pi tab in `SettingsModal.tsx`**

In `packages/ui/src/components/settings/SettingsModal.tsx`:

1. Update the type imports (around line 6-19) to add `PiThinkingLevel`:

```ts
import {
    MSG,
    ALL_AGENT_TYPES,
    type AgentType,
    type ShellInfo,
    type ShellListResponse,
    type RuntimeInfo,
    type RuntimeListResponse,
    type ClaudeSettings,
    type CodexSettings,
    type GeminiSettings,
    type PiThinkingLevel,
    type EditorInfo,
    type SystemInfoResponse,
} from "@taskflow/shared";
```

2. Add the `PiSection` import next to `GeminiSection` / `OpenCodeSection` (around line 35-36):

```ts
import { GeminiSection } from "./sections/GeminiSection";
import { OpenCodeSection } from "./sections/OpenCodeSection";
import { PiSection } from "./sections/PiSection";
```

3. Extend the `SectionKey` type (around line 41-49):

```ts
type SectionKey =
    | "general"
    | "defaults"
    | "claude"
    | "codex"
    | "opencode"
    | "gemini"
    | "cursor"
    | "pi"
    | "remote-agent";
```

4. Update the `handleDefaultAgent` guard (around line 246-259) to include `"pi"`:

```ts
    const handleDefaultAgent = useCallback(
        (value: string) => {
            if (
                value === "claude" ||
                value === "codex" ||
                value === "opencode" ||
                value === "gemini" ||
                value === "cursor" ||
                value === "pi"
            ) {
                void updateSettings({ general: { defaultAgent: value } });
            }
        },
        [updateSettings],
    );
```

5. Add three new handler callbacks right after `handleCursorYolo` (around line 403):

```ts
    const handlePiModel = useCallback(
        (defaultModel: string) => {
            void updateSettings({ pi: { defaultModel } });
        },
        [updateSettings],
    );

    const handlePiThinking = useCallback(
        (thinking: PiThinkingLevel) => {
            void updateSettings({ pi: { thinking } });
        },
        [updateSettings],
    );

    const handlePiTools = useCallback(
        (tools: string) => {
            void updateSettings({ pi: { tools } });
        },
        [updateSettings],
    );
```

6. Add a Pi nav entry (around line 416-425). Insert the `"pi"` tab between `"cursor"` and `"remote-agent"`:

```ts
    const navItems: { key: SectionKey; label: string }[] = [
        { key: "general", label: "General" },
        { key: "defaults", label: "Defaults" },
        { key: "claude", label: "Claude" },
        { key: "codex", label: "Codex" },
        { key: "opencode", label: "OpenCode" },
        { key: "gemini", label: "Gemini" },
        { key: "cursor", label: "Cursor" },
        { key: "pi", label: "Pi" },
        ...(claudeAvailable ? [{ key: "remote-agent" as const, label: "Remote Agent" }] : []),
    ];
```

7. Add the render branch right after the `cursor` section (around line 553):

```tsx
                        {section === "cursor" && (
                            <div className="flex flex-col gap-3 p-3">
                                <CursorOptions
                                    mode="defaults"
                                    modelValue={settings.cursor.defaultModel}
                                    yolo={settings.cursor.yolo}
                                    onModelChange={handleCursorModel}
                                    onYoloChange={handleCursorYolo}
                                />
                            </div>
                        )}

                        {section === "pi" && (
                            <div className="flex flex-col gap-3 p-3">
                                <PiSection
                                    defaultModel={settings.pi.defaultModel}
                                    thinking={settings.pi.thinking}
                                    tools={settings.pi.tools}
                                    onModelChange={handlePiModel}
                                    onThinkingChange={handlePiThinking}
                                    onToolsChange={handlePiTools}
                                />
                            </div>
                        )}
```

- [ ] **Step 7.3: Commit**

```bash
git add packages/ui/src/components/settings/sections/PiSection.tsx packages/ui/src/components/settings/SettingsModal.tsx
git commit -m "feat(ui): add Pi settings section"
```

---

## Task 8: UI — normalize-agent-options and remaining literal unions

Updates the agent-options normalizer and the last few UI spots that hold literal agent-type unions. After this task, the full UI package should typecheck clean.

**Files:**
- Modify: `packages/ui/src/lib/normalize-agent-options.ts`
- Modify: `packages/ui/src/components/workspace/Workspace.tsx`
- Modify: `packages/ui/src/components/sidebar/NewTaskDialog.tsx`
- Modify: `packages/ui/src/components/sidebar/TaskCreationDialogHost.tsx`

- [ ] **Step 8.1: Add `"pi"` case to `normalizeAgentOptions`**

In `packages/ui/src/lib/normalize-agent-options.ts`, add a new case right before the `default` branch (around line 59):

```ts
        case "cursor":
            if (agentOptions.type !== "cursor") return undefined;
            return {
                type: "cursor",
                yolo: agentOptions.yolo || undefined,
                model: agentOptions.model,
            };
        case "pi":
            if (agentOptions.type !== "pi") return undefined;
            return {
                type: "pi",
                model: agentOptions.model,
                thinking: agentOptions.thinking,
                tools: agentOptions.tools,
            };
        default:
            return undefined;
```

- [ ] **Step 8.2: Update `Workspace.tsx` literal unions**

In `packages/ui/src/components/workspace/Workspace.tsx`:

1. Line 175 (`handleNewTab`):

```ts
    const handleNewTab = async (
        type: "claude" | "codex" | "opencode" | "gemini" | "cursor" | "pi" | "browser" | "shell",
        shellPath?: string,
    ) => {
```

2. Line 369 (`handleRunTab`):

```ts
    const handleRunTab = async (
        type: "claude" | "codex" | "opencode" | "gemini" | "cursor" | "pi",
        agentOptions?: AgentLaunchOptions,
    ) => {
```

- [ ] **Step 8.3: Update `NewTaskDialog.tsx` literal union**

In `packages/ui/src/components/sidebar/NewTaskDialog.tsx` line 42:

```ts
        startWith?: "claude" | "codex" | "opencode" | "gemini" | "cursor" | "pi";
```

- [ ] **Step 8.4: Update `TaskCreationDialogHost.tsx` literal unions**

In `packages/ui/src/components/sidebar/TaskCreationDialogHost.tsx`:

1. Line 14:

```ts
    type: "claude" | "codex" | "opencode" | "gemini" | "cursor" | "pi";
```

2. Line 106:

```ts
            startWith?: "claude" | "codex" | "opencode" | "gemini" | "cursor" | "pi";
```

- [ ] **Step 8.5: Typecheck the UI package**

```bash
bun run --filter @taskflow/ui typecheck
```

Expected: clean exit. If a literal union elsewhere still rejects `"pi"`, the compiler error message will name the file and line — add `"pi"` there and rerun.

- [ ] **Step 8.6: Typecheck the whole workspace**

```bash
bun run typecheck
```

Expected: clean exit across all packages.

- [ ] **Step 8.7: Commit**

```bash
git add packages/ui/src/lib/normalize-agent-options.ts packages/ui/src/components/workspace/Workspace.tsx packages/ui/src/components/sidebar/NewTaskDialog.tsx packages/ui/src/components/sidebar/TaskCreationDialogHost.tsx
git commit -m "feat(ui): thread Pi agent type through remaining literal unions"
```

---

## Task 9: Verification

Final build, lint, and manual smoke test.

- [ ] **Step 9.1: Run all backend tests**

```bash
bun test
```

Expected: the full test suite passes, including the four new `parsePiModelsOutput` tests from Task 2.

- [ ] **Step 9.2: Run lint**

```bash
bun run lint
```

Expected: clean exit. If there are Pi-related lint errors, fix them inline before continuing. Per project convention, do not disable rules — find the proper fix.

- [ ] **Step 9.3: Run a production build**

```bash
bun run build
```

Expected: all packages build successfully. This catches any runtime-only issues the typechecker missed (e.g. missing file exports, broken dynamic imports).

- [ ] **Step 9.4: Manual smoke test**

Launch the Electron app from the worktree:

```bash
bun run dev
```

Once the app opens:

1. Open Settings → the left nav should show a "Pi" tab between Cursor and Remote Agent. Open it. Confirm the Model dropdown, Thinking dropdown, and Tools input render. Click the Model dropdown — it should fetch models from `pi --list-models` and populate; verify you see the provider/id plus context/thinking/images badges. Pick a model and type-narrow the thinking to e.g. "medium".

2. Close Settings. Open the current task (or any task) and start a new Pi session from the agent picker. The session tab should show the π icon. The session should launch `pi` with the correct flags; inspect the taskflow log or process list to confirm e.g. `pi --model openai-codex/gpt-5.4 --thinking medium --tools read,bash,edit,write,grep,find,ls --append-system-prompt "…"`.

3. Inside the Pi session, run `taskflow-cli task` and confirm it returns the current task JSON — this proves the taskflow system prompt and skill references are reaching Pi correctly and the taskflow-cli bin is on PATH.

4. Edit the Pi options on a fresh session: clear the Tools field entirely and start another session. Confirm the spawned command omits `--tools` (Pi falls back to its built-in 4-tool default).

5. Stop all Pi sessions.

- [ ] **Step 9.5: Log the task as done**

```bash
taskflow-cli log info "Pi agent support implemented and verified via manual smoke test"
```

- [ ] **Step 9.6: No commit**

Step 9 is verification only — there should be nothing to commit unless a step caught a bug. If any step above found an issue, fix it, re-run the relevant step, and add a follow-up commit with a clear message (`fix(ui): …` or `fix(backend): …`).

---

## Self-review notes

- Every spec requirement maps to a task: shared types → Task 1; model list fetch + `KNOWN_AGENTS` → Task 2; `buildAgentLaunchSpec` branch + session-lifecycle + default settings → Task 3; icon + tab metadata → Task 4; `PiModelSelect` → Task 5; `PiOptions` + `AgentOptionsPanel` → Task 6; `PiSection` + `SettingsModal` → Task 7; normalizer + remaining literal unions → Task 8; verification → Task 9.
- Method signatures and property names are consistent across tasks: `parsePiModelsOutput` / `fetchPiModels` (Task 2), `PiLaunchOptions { type, model, thinking, tools }` (Task 1, referenced in Tasks 3/6/8), `PiSettings { defaultModel, thinking, tools }` (Task 1, used in Steps 3.3, 3.5, 7.2), `PiModelInfo { provider, id, contextWindow, maxOutput, supportsThinking, supportsImages }` (Task 1, produced in Step 2.3, consumed in Task 5).
- Every step names exact file paths and shows the exact code to add. No grep-and-hope instructions, no "similar to Task N" back-references, no "appropriate error handling" hand-waving.
- TDD is observed for the only piece with non-trivial logic (the parser in Task 2); other tasks are wiring with no business logic worth unit-testing, matching the existing per-agent precedent in this codebase.
