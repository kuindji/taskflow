# Agent Launch Options Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add configurable launch options (full access, worktree, model) for Claude and Codex agents at all session-creation points.

**Architecture:** Discriminated union types (`ClaudeLaunchOptions` / `CodexLaunchOptions` with `type` field) flow from UI through WebSocket to backend, where `buildAgentLaunchSpec()` maps them to CLI flags. A reusable `AgentOptionsPanel` component renders agent-specific controls and is integrated into TabBar (Shift+click popover, Run hover submenu) and NewTaskDialog (inline panel).

**Tech Stack:** TypeScript, React, Radix UI (DropdownMenu, Popover, Select), Zustand, WebSocket

**Spec:** `docs/superpowers/specs/2026-03-12-agent-launch-options-design.md`

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `packages/shared/src/types/agent.ts` | Create | `ClaudeLaunchOptions`, `CodexLaunchOptions`, `AgentLaunchOptions` types |
| `packages/shared/src/index.ts` | Modify | Re-export from `agent.ts` |
| `packages/shared/src/types/ws.ts` | Modify | Add `agentOptions` to `SessionCreatePayload` |
| `packages/backend/src/services/internal-agent-skill.ts` | Modify | Map `agentOptions` to CLI flags in `buildAgentLaunchSpec()` |
| `packages/backend/src/handlers/session.ts` | Modify | Forward `agentOptions` from payload |
| `packages/ui/src/stores/session-store.ts` | Modify | Add `agentOptions` param to `createSession()` |
| `packages/ui/src/components/workspace/AgentOptionsPanel.tsx` | Create | Reusable options panel (switches + model select) |
| `packages/ui/src/components/workspace/TabBar.tsx` | Modify | Shift+click popover, Run hover submenu |
| `packages/ui/src/components/workspace/Workspace.tsx` | Modify | Forward `agentOptions` in `handleNewTab`/`handleRunTab` |
| `packages/ui/src/components/sidebar/NewTaskDialog.tsx` | Modify | Inline `AgentOptionsPanel` below agent select |
| `packages/ui/src/components/sidebar/NewTaskControl.tsx` | Modify | Forward `agentOptions` to `createSession()` |

---

## Chunk 1: Shared Types + Backend

### Task 1: Create agent launch option types

**Files:**
- Create: `packages/shared/src/types/agent.ts`
- Modify: `packages/shared/src/index.ts`

- [ ] **Step 1: Create `agent.ts` with discriminated union types**

```ts
// packages/shared/src/types/agent.ts

export interface ClaudeLaunchOptions {
    type: "claude";
    fullAccess?: boolean;
    worktree?: boolean;
    model?: "opus" | "sonnet" | "haiku";
}

export interface CodexLaunchOptions {
    type: "codex";
    fullAccess?: boolean;
}

export type AgentLaunchOptions = ClaudeLaunchOptions | CodexLaunchOptions;
```

- [ ] **Step 2: Add re-export to shared index**

Add this line to `packages/shared/src/index.ts` after the existing exports:

```ts
export * from "./types/agent";
```

- [ ] **Step 3: Add `agentOptions` to `SessionCreatePayload`**

In `packages/shared/src/types/ws.ts`, add the import at the top:

```ts
import type { AgentLaunchOptions } from "./agent";
```

Then add `agentOptions` field to `SessionCreatePayload` (after `rows?: number;` on line 99):

```ts
    agentOptions?: AgentLaunchOptions;
```

- [ ] **Step 4: Verify types compile**

Run: `cd packages/shared && bun tsc --noEmit`
Expected: No errors

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/types/agent.ts packages/shared/src/index.ts packages/shared/src/types/ws.ts
git commit -m "feat: add agent launch options types (ClaudeLaunchOptions, CodexLaunchOptions)"
```

---

### Task 2: Update backend to map agent options to CLI flags

**Files:**
- Modify: `packages/backend/src/services/internal-agent-skill.ts`
- Modify: `packages/backend/src/handlers/session.ts`

- [ ] **Step 1: Update `buildAgentLaunchSpec()` to accept and use `agentOptions`**

In `packages/backend/src/services/internal-agent-skill.ts`, add the import:

```ts
import type { AgentLaunchOptions } from "@taskflow/shared";
```

Update the function signature at line 211 to add the `agentOptions` parameter:

```ts
export function buildAgentLaunchSpec(
    type: "claude" | "codex",
    prompt: string | undefined,
    skillPath: string,
    agentOptions?: AgentLaunchOptions,
): { command: string; args: string[] } {
```

For the Claude branch (inside `if (type === "claude")`), add the agent options flags before the existing `--allowedTools` args. Replace lines 216-227 with:

```ts
    if (type === "claude") {
        const optionArgs: string[] = [];
        if (agentOptions?.type === "claude") {
            if (agentOptions.fullAccess) optionArgs.push("--dangerously-skip-permissions");
            if (agentOptions.worktree) optionArgs.push("--worktree");
            if (agentOptions.model) optionArgs.push("--model", agentOptions.model);
        }
        return {
            command: "claude",
            args: [
                ...optionArgs,
                "--allowedTools",
                "Bash(taskflow-cli*)",
                "--append-system-prompt",
                INTERNAL_AGENT_SYSTEM_PROMPT,
                ...(prompt ? [prompt] : []),
            ],
        };
    }
```

For the Codex branch, replace lines 229-238 with:

```ts
    const optionArgs: string[] = [];
    if (agentOptions?.type === "codex") {
        if (agentOptions.fullAccess) optionArgs.push("--full-auto");
    }
    return {
        command: "codex",
        args: [
            ...optionArgs,
            "-c",
            `developer_instructions="${escapeTomlBasicString(INTERNAL_AGENT_SYSTEM_PROMPT)}"`,
            "-c",
            `skills.config=[{path="${escapeTomlBasicString(skillPath)}", enabled=true}]`,
            ...(prompt ? [prompt] : []),
        ],
    };
```

- [ ] **Step 2: Forward `agentOptions` in session handler**

In `packages/backend/src/handlers/session.ts`, update the destructuring on line 84 to include `agentOptions`:

```ts
        const { taskId, projectId, type, label, prompt, shell, cols, rows, agentOptions } = payload as SessionCreatePayload;
```

Add `SessionCreatePayload` to the import if not already there (it should be — check line 3).

Then update the `buildAgentLaunchSpec` call on line 107 to pass `agentOptions`:

```ts
            const spec = buildAgentLaunchSpec(type, prompt, skillPath, agentOptions);
```

- [ ] **Step 3: Verify backend compiles**

Run: `cd packages/backend && bun tsc --noEmit`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add packages/backend/src/services/internal-agent-skill.ts packages/backend/src/handlers/session.ts
git commit -m "feat: map agent launch options to CLI flags in buildAgentLaunchSpec"
```

---

## Chunk 2: Session Store + AgentOptionsPanel

### Task 3: Update session store to accept agent options

**Files:**
- Modify: `packages/ui/src/stores/session-store.ts`

- [ ] **Step 1: Add `agentOptions` parameter to `createSession`**

In `packages/ui/src/stores/session-store.ts`, add the import:

```ts
import type { AgentLaunchOptions } from "@taskflow/shared";
```

Update the `createSession` method signature in the `SessionStore` interface (line 32-38) to:

```ts
    createSession(
        owner: { taskId?: string; projectId?: string },
        type: "claude" | "codex" | "shell",
        label?: string,
        prompt?: string,
        shell?: string,
        agentOptions?: AgentLaunchOptions,
    ): Promise<string>;
```

Update the implementation (line 113) to accept the new param:

```ts
    async createSession(owner, type, label, prompt, shell, agentOptions) {
```

Add `agentOptions` to the `sendRequest` payload (after `rows`, around line 125):

```ts
            agentOptions,
```

So the full sendRequest call becomes:

```ts
        const { sessionId } = await sendRequest<{ sessionId: string }>(MSG.SESSION_CREATE, {
            ...owner,
            type,
            label,
            prompt,
            shell,
            cols: lastTerminalSize?.cols,
            rows: lastTerminalSize?.rows,
            agentOptions,
        });
```

- [ ] **Step 2: Verify UI compiles**

Run: `cd packages/ui && bun tsc --noEmit`
Expected: No errors (existing callers don't pass `agentOptions`, which is optional)

- [ ] **Step 3: Commit**

```bash
git add packages/ui/src/stores/session-store.ts
git commit -m "feat: add agentOptions parameter to session store createSession"
```

---

### Task 4: Create AgentOptionsPanel component

**Files:**
- Create: `packages/ui/src/components/workspace/AgentOptionsPanel.tsx`

- [ ] **Step 1: Create the AgentOptionsPanel component**

This component renders agent-specific launch options and a Run button. It uses the existing `Switch`, `Label`, `Select`, and `Button` UI primitives.

```tsx
// packages/ui/src/components/workspace/AgentOptionsPanel.tsx
import { useState } from "react";
import type { AgentLaunchOptions } from "@taskflow/shared";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { Play } from "lucide-react";

interface AgentOptionsPanelProps {
    agentType: "claude" | "codex";
    onRun: (options: AgentLaunchOptions) => void;
}

function AgentOptionsPanel({ agentType, onRun }: AgentOptionsPanelProps) {
    const [fullAccess, setFullAccess] = useState(false);
    const [worktree, setWorktree] = useState(false);
    const [model, setModel] = useState("default");

    const handleRun = () => {
        if (agentType === "claude") {
            onRun({
                type: "claude",
                fullAccess: fullAccess || undefined,
                worktree: worktree || undefined,
                model: model === "default" ? undefined : model as "opus" | "sonnet" | "haiku",
            });
        } else {
            onRun({
                type: "codex",
                fullAccess: fullAccess || undefined,
            });
        }
    };

    return (
        <div className="flex flex-col gap-3 p-3">
            <div className="flex items-center gap-2">
                <Switch
                    id="agent-full-access"
                    checked={fullAccess}
                    onCheckedChange={setFullAccess}
                />
                <Label htmlFor="agent-full-access" className="cursor-pointer text-xs">
                    Full access
                </Label>
            </div>

            {agentType === "claude" && (
                <>
                    <div className="flex items-center gap-2">
                        <Switch
                            id="agent-worktree"
                            checked={worktree}
                            onCheckedChange={setWorktree}
                        />
                        <Label htmlFor="agent-worktree" className="cursor-pointer text-xs">
                            Worktree
                        </Label>
                    </div>

                    <div className="flex flex-col gap-1">
                        <Label htmlFor="agent-model" className="text-xs">
                            Model
                        </Label>
                        <Select value={model} onValueChange={setModel}>
                            <SelectTrigger id="agent-model" className="h-7 text-xs">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="default">Default</SelectItem>
                                <SelectItem value="opus">Opus</SelectItem>
                                <SelectItem value="sonnet">Sonnet</SelectItem>
                                <SelectItem value="haiku">Haiku</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                </>
            )}

            <Button size="sm" className="w-full" onClick={handleRun}>
                <Play className="mr-1 h-3 w-3" />
                Run
            </Button>
        </div>
    );
}

export { AgentOptionsPanel };
```

- [ ] **Step 2: Verify component compiles**

Run: `cd packages/ui && bun tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add packages/ui/src/components/workspace/AgentOptionsPanel.tsx
git commit -m "feat: create AgentOptionsPanel component for agent launch options"
```

---

## Chunk 3: TabBar + Workspace Integration

### Task 5: Add Shift+click popover and Run hover submenu to TabBar

**Files:**
- Modify: `packages/ui/src/components/workspace/TabBar.tsx`

- [ ] **Step 1: Add imports**

In `packages/ui/src/components/workspace/TabBar.tsx`, add these imports:

```ts
import type { AgentLaunchOptions } from "@taskflow/shared";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
    DropdownMenuSub,
    DropdownMenuSubTrigger,
    DropdownMenuSubContent,
} from "@/components/ui/dropdown-menu";
import { AgentOptionsPanel } from "./AgentOptionsPanel";
```

Add `useState` to the existing React import:

```ts
import { useMemo, useEffect, useState } from "react";
```

- [ ] **Step 2: Update TabBarProps**

Update the `onNewTab` and `onRunTab` props in the `TabBarProps` interface (lines 74-86):

```ts
interface TabBarProps {
    tabs: Tab[];
    activeTabId: string;
    onTabClick: (tabId: string) => void;
    onTabClose: (tabId: string) => void;
    onNewTab: (
        type: "claude" | "codex" | "browser" | "shell",
        shellPath?: string,
        agentOptions?: AgentLaunchOptions,
    ) => void;
    onRunTab: (type: "claude" | "codex", agentOptions?: AgentLaunchOptions) => void;
    showRunButton: boolean;
    allowSessionTabs: boolean;
}
```

- [ ] **Step 3: Add Shift+click popovers for Claude/Codex buttons**

Inside the `TabBar` component, add state for controlling the popovers:

```ts
    const [claudePopoverOpen, setClaudePopoverOpen] = useState(false);
    const [codexPopoverOpen, setCodexPopoverOpen] = useState(false);
```

Replace the Claude button (lines 139-148) with a Popover-wrapped version:

```tsx
                    <Popover open={claudePopoverOpen} onOpenChange={setClaudePopoverOpen}>
                        <PopoverTrigger asChild>
                            <Button
                                variant="ghost"
                                size="icon-xs"
                                className="text-warning"
                                onClick={(e) => {
                                    if (e.shiftKey) {
                                        setClaudePopoverOpen(true);
                                    } else {
                                        onNewTab("claude");
                                    }
                                }}
                                aria-label="New Claude session"
                                tooltip="New Claude session (Shift+click for options)"
                            >
                                <ClaudeIcon className="h-3.5 w-3.5" />
                            </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-56 p-0">
                            <AgentOptionsPanel
                                agentType="claude"
                                onRun={(options) => {
                                    setClaudePopoverOpen(false);
                                    onNewTab("claude", undefined, options);
                                }}
                            />
                        </PopoverContent>
                    </Popover>
```

Replace the Codex button (lines 149-158) similarly:

```tsx
                    <Popover open={codexPopoverOpen} onOpenChange={setCodexPopoverOpen}>
                        <PopoverTrigger asChild>
                            <Button
                                variant="ghost"
                                size="icon-xs"
                                className="text-success"
                                onClick={(e) => {
                                    if (e.shiftKey) {
                                        setCodexPopoverOpen(true);
                                    } else {
                                        onNewTab("codex");
                                    }
                                }}
                                aria-label="New Codex session"
                                tooltip="New Codex session (Shift+click for options)"
                            >
                                <CodexIcon className="h-3.5 w-3.5" />
                            </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-56 p-0">
                            <AgentOptionsPanel
                                agentType="codex"
                                onRun={(options) => {
                                    setCodexPopoverOpen(false);
                                    onNewTab("codex", undefined, options);
                                }}
                            />
                        </PopoverContent>
                    </Popover>
```

- [ ] **Step 4: Add hover submenu to Run button dropdown**

Replace the Run button dropdown content (lines 125-134) with submenu versions:

```tsx
                    <DropdownMenuContent align="start">
                        <DropdownMenuItem onClick={() => onRunTab("claude")}>
                            <ClaudeIcon className="mr-2 h-4 w-4" />
                            Claude Code
                        </DropdownMenuItem>
                        <DropdownMenuSub>
                            <DropdownMenuSubTrigger>
                                <ClaudeIcon className="mr-2 h-4 w-4" />
                                Claude Code with options
                            </DropdownMenuSubTrigger>
                            <DropdownMenuSubContent className="p-0">
                                <AgentOptionsPanel
                                    agentType="claude"
                                    onRun={(options) => onRunTab("claude", options)}
                                />
                            </DropdownMenuSubContent>
                        </DropdownMenuSub>
                        <DropdownMenuItem onClick={() => onRunTab("codex")}>
                            <CodexIcon className="mr-2 h-4 w-4" />
                            Codex
                        </DropdownMenuItem>
                        <DropdownMenuSub>
                            <DropdownMenuSubTrigger>
                                <CodexIcon className="mr-2 h-4 w-4" />
                                Codex with options
                            </DropdownMenuSubTrigger>
                            <DropdownMenuSubContent className="p-0">
                                <AgentOptionsPanel
                                    agentType="codex"
                                    onRun={(options) => onRunTab("codex", options)}
                                />
                            </DropdownMenuSubContent>
                        </DropdownMenuSub>
                    </DropdownMenuContent>
```

- [ ] **Step 5: Verify compiles**

Run: `cd packages/ui && bun tsc --noEmit`
Expected: No errors

- [ ] **Step 6: Commit**

```bash
git add packages/ui/src/components/workspace/TabBar.tsx
git commit -m "feat: add shift+click popover and run submenu for agent options in TabBar"
```

---

### Task 6: Update Workspace to forward agentOptions

**Files:**
- Modify: `packages/ui/src/components/workspace/Workspace.tsx`

- [ ] **Step 1: Add import**

```ts
import type { AgentLaunchOptions } from "@taskflow/shared";
```

- [ ] **Step 2: Update `handleNewTab` signature and forwarding**

Replace lines 92-123 with:

```ts
    const handleNewTab = async (
        type: "claude" | "codex" | "browser" | "shell",
        shellPath?: string,
        agentOptions?: AgentLaunchOptions,
    ) => {
        if (!workspace.workspaceKey) return;
        if (type === "browser") {
            addTab(workspace.workspaceKey, {
                id: crypto.randomUUID(),
                type: "browser",
                label: "New Tab",
                url: "about:blank",
            });
        } else if (type === "shell" && shellPath) {
            const shellName = shellPath.split("/").pop() ?? "shell";
            await createSession(
                workspace.scope === "task"
                    ? { taskId: workspace.task.id }
                    : { projectId: workspace.project.id },
                "shell",
                shellName,
                undefined,
                shellPath,
            );
        } else {
            await createSession(
                workspace.scope === "task"
                    ? { taskId: workspace.task.id }
                    : { projectId: workspace.project.id },
                type,
                undefined,
                undefined,
                undefined,
                agentOptions,
            );
        }
    };
```

- [ ] **Step 3: Update `handleRunTab` signature and forwarding**

Replace lines 125-133 with:

```ts
    const handleRunTab = async (type: "claude" | "codex", agentOptions?: AgentLaunchOptions) => {
        if (workspace.scope !== "task" || !workspace.task) return;
        await createSession(
            { taskId: workspace.task.id },
            type,
            undefined,
            workspace.task.description || undefined,
            undefined,
            agentOptions,
        );
    };
```

- [ ] **Step 4: Verify compiles**

Run: `cd packages/ui && bun tsc --noEmit`
Expected: No errors

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/components/workspace/Workspace.tsx
git commit -m "feat: forward agentOptions from TabBar through Workspace to createSession"
```

---

## Chunk 4: NewTaskDialog Integration

### Task 7: Add inline AgentOptionsPanel to NewTaskDialog

**Files:**
- Modify: `packages/ui/src/components/sidebar/NewTaskDialog.tsx`

- [ ] **Step 1: Add imports and state**

Add the import:

```ts
import type { AgentLaunchOptions } from "@taskflow/shared";
import { AgentOptionsPanel } from "@/components/workspace/AgentOptionsPanel";
```

Update the `onSubmit` prop type in `NewTaskDialogProps` to include `agentOptions`:

```ts
    onSubmit: (data: {
        projectId: string;
        title?: string;
        description: string;
        worktree: boolean;
        startWith?: "claude" | "codex";
        agentOptions?: AgentLaunchOptions;
    }) => void;
```

- [ ] **Step 2: Add agentOptions state and update handlers**

Inside the component, add state (after line 48):

```ts
    const [agentOptions, setAgentOptions] = useState<AgentLaunchOptions | undefined>(undefined);
```

Update `resetForm` to clear it:

```ts
    const resetForm = useCallback(() => {
        setDescription("");
        setTitle("");
        setWorktree(false);
        setStartWith("none");
        setAgentOptions(undefined);
    }, []);
```

Clear `agentOptions` when `startWith` changes to "none". Add a wrapper around `setStartWith`:

```ts
    const handleStartWithChange = useCallback((value: string) => {
        setStartWith(value);
        if (value === "none") setAgentOptions(undefined);
    }, []);
```

Use `handleStartWithChange` instead of `setStartWith` in the Select's `onValueChange`.

Update `handleSubmit` to include `agentOptions` in the submitted data (line 70-79):

```ts
    const handleSubmit = useCallback(() => {
        if (!canSubmit) return;
        onSubmit({
            projectId,
            title: title.trim() || undefined,
            description: description.trim(),
            worktree,
            startWith: startWith === "claude" || startWith === "codex" ? startWith : undefined,
            agentOptions,
        });
        resetForm();
        onOpenChange(false);
    }, [canSubmit, projectId, title, description, worktree, startWith, agentOptions, onSubmit, resetForm, onOpenChange]);
```

- [ ] **Step 3: Add inline AgentOptionsPanel in the JSX**

After the "Start immediately with" Select section (after line 167's closing `</div>`), add the conditional panel. Note: the `AgentOptionsPanel` here should NOT show its own Run button since the dialog has its own "Create Task" button. We need to handle this differently — instead of using the full `AgentOptionsPanel` with its Run button, render just the options inline.

Actually, for the NewTaskDialog, we should render the options controls inline without the Run button, since "Create Task" serves as the action button. The cleanest approach: render a version of the panel without the Run button by making the Run button conditional.

Update `AgentOptionsPanelProps` in `AgentOptionsPanel.tsx` to support hiding the Run button:

```tsx
interface AgentOptionsPanelProps {
    agentType: "claude" | "codex";
    onRun?: (options: AgentLaunchOptions) => void;
    onChange?: (options: AgentLaunchOptions) => void;
}
```

In `AgentOptionsPanel`, build the current options object and call `onChange` whenever any value changes. Only show the Run button when `onRun` is provided. Add `useEffect` and `useRef` to the import:

```tsx
import { useState, useEffect, useRef } from "react";
```

Add after the state declarations:

```tsx
    const isFirstRender = useRef(true);

    useEffect(() => {
        if (isFirstRender.current) {
            isFirstRender.current = false;
            return;
        }
        if (!onChange) return;
        if (agentType === "claude") {
            onChange({
                type: "claude",
                fullAccess: fullAccess || undefined,
                worktree: worktree || undefined,
                model: model === "default" ? undefined : model as "opus" | "sonnet" | "haiku",
            });
        } else {
            onChange({
                type: "codex",
                fullAccess: fullAccess || undefined,
            });
        }
    }, [agentType, fullAccess, worktree, model, onChange]);
```

Wrap the Run button in a conditional:

```tsx
            {onRun && (
                <Button size="sm" className="w-full" onClick={handleRun}>
                    <Play className="mr-1 h-3 w-3" />
                    Run
                </Button>
            )}
```

Then in `NewTaskDialog.tsx`, add the panel after the Select, before the closing `</div>` of the form fields section:

```tsx
                    {(startWith === "claude" || startWith === "codex") && (
                        <div className="border-border rounded-md border p-1">
                            <AgentOptionsPanel
                                agentType={startWith}
                                onChange={setAgentOptions}
                            />
                        </div>
                    )}
```

- [ ] **Step 4: Verify compiles**

Run: `cd packages/ui && bun tsc --noEmit`
Expected: No errors

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/components/workspace/AgentOptionsPanel.tsx packages/ui/src/components/sidebar/NewTaskDialog.tsx
git commit -m "feat: add inline agent options panel to NewTaskDialog"
```

---

### Task 8: Update NewTaskControl to forward agentOptions

**Files:**
- Modify: `packages/ui/src/components/sidebar/NewTaskControl.tsx`

- [ ] **Step 1: Add import and update handleCreateTask**

Add the import:

```ts
import type { AgentLaunchOptions } from "@taskflow/shared";
```

Update `handleCreateTask` (lines 72-97) to include `agentOptions` in the parameter type and forward it:

```ts
    const handleCreateTask = useCallback(
        async (data: {
            projectId: string;
            title?: string;
            description: string;
            worktree: boolean;
            startWith?: "claude" | "codex";
            agentOptions?: AgentLaunchOptions;
        }) => {
            try {
                const task = await createTask(data);
                setActiveProject(task.projectId);
                setActiveTask(task.id);
                if (data.startWith) {
                    await createSession(
                        { taskId: task.id },
                        data.startWith,
                        undefined,
                        data.description,
                        undefined,
                        data.agentOptions,
                    );
                }
            } catch (err) {
                console.error("Failed to create task:", err);
            }
        },
        [createSession, createTask, setActiveProject, setActiveTask],
    );
```

- [ ] **Step 2: Verify full project compiles**

Run: `cd packages/ui && bun tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add packages/ui/src/components/sidebar/NewTaskControl.tsx
git commit -m "feat: forward agentOptions from NewTaskDialog through NewTaskControl to createSession"
```

---

### Task 9: Final verification

- [ ] **Step 1: Verify all packages compile**

Run: `cd /Users/kuindji/Projects/taskflow && bun run --filter '*' tsc --noEmit` or verify each package individually:

```bash
cd packages/shared && bun tsc --noEmit
cd ../backend && bun tsc --noEmit
cd ../ui && bun tsc --noEmit
```

Expected: No errors in any package

- [ ] **Step 2: Manual smoke test**

1. Start the app
2. Click Claude button → should launch with defaults (no options)
3. Shift+click Claude button → popover should appear with Full access switch, Worktree switch, Model dropdown, Run button
4. Click Run with Full access on → session should start, verify `--dangerously-skip-permissions` in the spawned command
5. Shift+click Codex button → popover should show only Full access switch + Run
6. Click Run dropdown → hover Claude → submenu with options should appear
7. Create new task with "Start with Claude" → options panel should appear inline below the select
8. Create task with Full access + Worktree → verify flags passed correctly
