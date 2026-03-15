# OpenCode Agent Support Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add OpenCode as a third agent alongside Claude and Codex, with model selection, full access toggle, settings, icon, and launch integration.

**Architecture:** Follow the exact same patterns used by the existing Claude and Codex agents. Every location that branches on agent type gets an `"opencode"` branch. OpenCode config injection (instructions + permissions) uses the `OPENCODE_CONFIG_CONTENT` env var.

**Tech Stack:** TypeScript, React, Zustand, Bun, xterm.js

**Spec:** `docs/superpowers/specs/2026-03-15-opencode-agent-design.md`

---

## Chunk 1: Shared Types and Backend

### Task 1: Extend shared agent types

**Files:**
- Modify: `packages/shared/src/types/agent.ts`

- [ ] **Step 1: Add OpenCode to AgentType and create OpenCodeLaunchOptions**

In `packages/shared/src/types/agent.ts`, add `"opencode"` to the `AgentType` union, create the `OpenCodeLaunchOptions` interface, extend `AgentLaunchOptions`, and export the new type:

```ts
type AgentType = "claude" | "codex" | "opencode";

interface OpenCodeLaunchOptions {
    type: Extract<AgentType, "opencode">;
    fullAccess?: boolean;
    model?: string;
}

type AgentLaunchOptions = ClaudeLaunchOptions | CodexLaunchOptions | OpenCodeLaunchOptions;

export type { AgentType, ClaudeLaunchOptions, CodexLaunchOptions, OpenCodeLaunchOptions, AgentLaunchOptions, AgentAvailability };
```

- [ ] **Step 2: Add OpenCode to SessionRef type**

In `packages/shared/src/types/task.ts`, line 5, change:
```ts
type: "claude" | "codex" | "shell";
```
to:
```ts
type: "claude" | "codex" | "opencode" | "shell";
```

- [ ] **Step 3: Add OpenCode to SessionCreatePayload type**

In `packages/shared/src/types/ws.ts`, line 103, change:
```ts
type: "claude" | "codex" | "shell";
```
to:
```ts
type: "claude" | "codex" | "opencode" | "shell";
```

- [ ] **Step 4: Add OpenCodeSettings and extend AppSettings**

In `packages/shared/src/types/settings.ts`:

Add after `CodexSettings`:
```ts
export interface OpenCodeSettings {
    defaultModel: string;
    fullAccess: boolean;
}
```

Add `opencode: OpenCodeSettings;` to `AppSettings` (after line 63 `codex: CodexSettings;`).

Add `opencode?: Partial<OpenCodeSettings>;` to `SettingsUpdatePayload` (after line 76 `codex?: Partial<CodexSettings>;`).

- [ ] **Step 5: Verify types compile**

Run: `cd packages/shared && bun tsc --noEmit`
Expected: No errors (or only pre-existing ones unrelated to these changes).

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/types/agent.ts packages/shared/src/types/task.ts packages/shared/src/types/ws.ts packages/shared/src/types/settings.ts
git commit -m "feat: add OpenCode to shared agent types"
```

### Task 2: Add OpenCode to runtime detector

**Files:**
- Modify: `packages/backend/src/services/runtime-detector.ts`

- [ ] **Step 1: Add "opencode" to KNOWN_AGENTS**

In `packages/backend/src/services/runtime-detector.ts`, line 35, change:
```ts
const KNOWN_AGENTS: AgentType[] = ["claude", "codex"];
```
to:
```ts
const KNOWN_AGENTS: AgentType[] = ["claude", "codex", "opencode"];
```

No other changes needed — `detectAgents()` already iterates the array generically and uses `Bun.which(type)` for lookup and `--version` for version detection.

- [ ] **Step 2: Commit**

```bash
git add packages/backend/src/services/runtime-detector.ts
git commit -m "feat: add opencode to agent detection"
```

### Task 3: Add OpenCode launch spec

**Files:**
- Modify: `packages/backend/src/services/internal-agent-skill.ts`

- [ ] **Step 1: Extend buildAgentLaunchSpec return type and function signature**

In `packages/backend/src/services/internal-agent-skill.ts`, change the function signature (line 256-261) from:

```ts
export function buildAgentLaunchSpec(
    type: "claude" | "codex",
    prompt: string | undefined,
    skillPath: string,
    agentOptions?: AgentLaunchOptions,
): { command: string; args: string[] } {
```

to:

```ts
export function buildAgentLaunchSpec(
    type: "claude" | "codex" | "opencode",
    prompt: string | undefined,
    skillPath: string,
    agentOptions?: AgentLaunchOptions,
): { command: string; args: string[]; env?: Record<string, string> } {
```

- [ ] **Step 2: Add OpenCode branch before the Codex fallback**

After the closing `}` of the Claude `if` block (line 279), add the OpenCode branch:

```ts
    if (type === "opencode") {
        const config: Record<string, unknown> = {
            instructions: [skillPath],
        };
        if (agentOptions?.type === "opencode" && agentOptions.fullAccess) {
            config.permission = { edit: "allow", bash: "allow", write: "allow" };
        }

        const args: string[] = [];
        if (agentOptions?.type === "opencode" && agentOptions.model) {
            args.push("--model", agentOptions.model);
        }
        if (prompt) args.push("--prompt", prompt);

        return {
            command: "opencode",
            args,
            env: { OPENCODE_CONFIG_CONTENT: JSON.stringify(config) },
        };
    }
```

- [ ] **Step 3: Verify backend compiles**

Run: `cd packages/backend && bun tsc --noEmit`
Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add packages/backend/src/services/internal-agent-skill.ts
git commit -m "feat: add opencode launch spec to buildAgentLaunchSpec"
```

### Task 4: Update session handler to merge spec env

**Files:**
- Modify: `packages/backend/src/handlers/session.ts`

- [ ] **Step 1: Add OpenCode to getDefaultSessionLabel**

In `packages/backend/src/handlers/session.ts`, after line 33 (`if (type === "codex") return "Codex";`), add:
```ts
    if (type === "opencode") return "OpenCode";
```

- [ ] **Step 2: Merge spec.env into PTY spawn environment**

The `taskflowEnv` object is declared at line 127, after the if/else block where `buildAgentLaunchSpec` is called (line 121). We need to hoist `spec.env` out of the else block so it can be merged into `taskflowEnv` later.

After line 111 (`const args: string[] = [];`), add:
```ts
        let specEnv: Record<string, string> | undefined;
```

Then at line 123 (after `args.push(...spec.args);`), add:
```ts
            specEnv = spec.env;
```

Then at line 139 (the `env: taskflowEnv` inside `ptyManager.spawn`), change:
```ts
            env: taskflowEnv,
```
to:
```ts
            env: specEnv ? { ...taskflowEnv, ...specEnv } : taskflowEnv,
```

- [ ] **Step 3: Verify backend compiles**

Run: `cd packages/backend && bun tsc --noEmit`
Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add packages/backend/src/handlers/session.ts
git commit -m "feat: update session handler for opencode agent support"
```

### Task 5: Add OpenCode settings defaults

**Files:**
- Modify: `packages/backend/src/services/settings-store.ts`

- [ ] **Step 1: Add opencode defaults**

In `packages/backend/src/services/settings-store.ts`, after line 46 (`codex: { fullAccess: false },`), add:
```ts
    opencode: {
        defaultModel: "",
        fullAccess: false,
    },
```

- [ ] **Step 2: Add opencode to createDefaultSettings**

After line 63 (`codex: { ...DEFAULTS.codex },`), add:
```ts
        opencode: { ...DEFAULTS.opencode },
```

- [ ] **Step 3: Add opencode to get() merge**

After line 84 (`codex: { ...defaults.codex, ...parsed.codex },`), add:
```ts
                opencode: { ...defaults.opencode, ...parsed.opencode },
```

- [ ] **Step 4: Add opencode to update()**

After line 113 (`if (partial.codex) { Object.assign(current.codex, partial.codex); }`), add:
```ts
        if (partial.opencode) {
            Object.assign(current.opencode, partial.opencode);
        }
```

- [ ] **Step 5: Verify backend compiles**

Run: `cd packages/backend && bun tsc --noEmit`
Expected: No errors.

- [ ] **Step 6: Commit**

```bash
git add packages/backend/src/services/settings-store.ts
git commit -m "feat: add opencode settings defaults"
```

## Chunk 2: UI — Icon, Store, Options Panel

### Task 6: Create OpenCode icon component

**Files:**
- Create: `packages/ui/src/components/icons/OpenCodeIcon.tsx`

- [ ] **Step 1: Create OpenCodeIcon.tsx**

Create `packages/ui/src/components/icons/OpenCodeIcon.tsx` following the pattern of `ClaudeIcon.tsx` and `CodexIcon.tsx`. Use an SVG that represents OpenCode's branding — a terminal/code bracket icon:

```tsx
import type { SVGProps } from "react";

function OpenCodeIcon(props: SVGProps<SVGSVGElement>) {
    return (
        <svg viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg" {...props}>
            <path d="M8.5 3.5L1.5 12l7 8.5M15.5 3.5l7 8.5-7 8.5" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
        </svg>
    );
}

export { OpenCodeIcon };
```

- [ ] **Step 2: Commit**

```bash
git add packages/ui/src/components/icons/OpenCodeIcon.tsx
git commit -m "feat: add OpenCode icon component"
```

### Task 7: Update session store for OpenCode

**Files:**
- Modify: `packages/ui/src/stores/session-store.ts`

- [ ] **Step 1: Add "opencode" to Tab.type union**

At line 21, change:
```ts
    type: "claude" | "codex" | "shell" | "editor" | "changes" | "browser";
```
to:
```ts
    type: "claude" | "codex" | "opencode" | "shell" | "editor" | "changes" | "browser";
```

- [ ] **Step 2: Add "opencode" to createSession parameter type**

At line 35, change:
```ts
        type: "claude" | "codex" | "shell",
```
to:
```ts
        type: "claude" | "codex" | "opencode" | "shell",
```

- [ ] **Step 3: Add "opencode" to getDefaultSessionLabel**

At line 58-62, after `if (type === "codex") return "Codex";` add:
```ts
    if (type === "opencode") return "OpenCode";
```

- [ ] **Step 4: Add "opencode" to usesTerminalActivityStatus**

At line 108, change:
```ts
    return type === "claude" || type === "codex";
```
to:
```ts
    return type === "claude" || type === "codex" || type === "opencode";
```

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/stores/session-store.ts
git commit -m "feat: add opencode to session store types"
```

### Task 8: Update AgentOptionsPanel for OpenCode

**Files:**
- Modify: `packages/ui/src/components/workspace/AgentOptionsPanel.tsx`

- [ ] **Step 1: Extend agentType prop and add opencode settings**

In `packages/ui/src/components/workspace/AgentOptionsPanel.tsx`:

Change the interface (line 17):
```ts
    agentType: "claude" | "codex";
```
to:
```ts
    agentType: "claude" | "codex" | "opencode";
```

Add opencode settings selector after line 24:
```ts
    const opencodeSettings = useSettingsStore((s) => s.settings?.opencode);
```

Update `defaultFullAccess` (lines 26-29) to:
```ts
    const defaultFullAccess =
        agentType === "claude"
            ? (claudeSettings?.fullAccess ?? false)
            : agentType === "opencode"
              ? (opencodeSettings?.fullAccess ?? false)
              : (codexSettings?.fullAccess ?? false);
```

Update `defaultModel` (line 30) to:
```ts
    const defaultModel =
        agentType === "claude"
            ? (claudeSettings?.defaultModel ?? "default")
            : agentType === "opencode"
              ? (opencodeSettings?.defaultModel ?? "")
              : "";
```

- [ ] **Step 2: Add OpenCode branch to onChange effect**

In the `useEffect` (lines 37-55), add an `opencode` branch. Replace the entire effect body after `isFirstRender` check:

```ts
        if (!onChange) return;
        if (agentType === "claude") {
            onChange({
                type: "claude",
                fullAccess: fullAccess || undefined,
                model: model === "default" ? undefined : (model as "opus" | "sonnet" | "haiku"),
            });
        } else if (agentType === "opencode") {
            onChange({
                type: "opencode",
                fullAccess: fullAccess || undefined,
                model: model || undefined,
            });
        } else {
            onChange({
                type: "codex",
                fullAccess: fullAccess || undefined,
            });
        }
```

- [ ] **Step 3: Add OpenCode branch to handleRun**

Update `handleRun` (lines 57-71) similarly:

```ts
    const handleRun = () => {
        if (!onRun) return;
        if (agentType === "claude") {
            onRun({
                type: "claude",
                fullAccess: fullAccess || undefined,
                model: model === "default" ? undefined : (model as "opus" | "sonnet" | "haiku"),
            });
        } else if (agentType === "opencode") {
            onRun({
                type: "opencode",
                fullAccess: fullAccess || undefined,
                model: model || undefined,
            });
        } else {
            onRun({
                type: "codex",
                fullAccess: fullAccess || undefined,
            });
        }
    };
```

- [ ] **Step 4: Add OpenCode model input to the JSX**

After the Claude model selector block (line 86-105), add:

```tsx
            {agentType === "opencode" && (
                <div className="flex flex-col gap-1">
                    <Label htmlFor="agent-model" className="text-xs">
                        Model
                    </Label>
                    <input
                        id="agent-model"
                        type="text"
                        className="bg-input border-border h-7 rounded-md border px-2 text-xs"
                        placeholder="e.g. anthropic/claude-sonnet-4-20250514"
                        value={model}
                        onChange={(e) => setModel(e.target.value)}
                    />
                </div>
            )}
```

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/components/workspace/AgentOptionsPanel.tsx
git commit -m "feat: add opencode support to AgentOptionsPanel"
```

## Chunk 3: UI — TabBar, Workspace, Dialogs, Settings

### Task 9: Update TabBar for OpenCode

**Files:**
- Modify: `packages/ui/src/components/workspace/TabBar.tsx`
- Modify: `packages/ui/src/styles/global.css`

- [ ] **Step 1: Add OpenCode CSS color variable**

In `packages/ui/src/styles/global.css`, after `--info-foreground: #1e1e2e;` (line 81), add:
```css
    --opencode: #cba6f7;
    --opencode-foreground: #1e1e2e;
```

After line 39 (`--color-info-foreground: var(--info-foreground);`), add:
```css
    --color-opencode: var(--opencode);
    --color-opencode-foreground: var(--opencode-foreground);
```

- [ ] **Step 2: Add imports and tab variant**

Add import at the top (after line 26):
```ts
import { OpenCodeIcon } from "@/components/icons/OpenCodeIcon";
```

Add `opencode` variant to `tabVariants` (after line 41 `codex: "text-success",`):
```ts
                opencode: "text-opencode",
```

- [ ] **Step 3: Extend TabBarProps types**

At line 142-143, change `onNewTab` type:
```ts
    onNewTab: (
        type: "claude" | "codex" | "opencode" | "browser" | "shell",
```

At line 147, change `onRunTab` type:
```ts
    onRunTab: (type: "claude" | "codex" | "opencode", agentOptions?: AgentLaunchOptions) => void;
```

- [ ] **Step 4: Add OpenCode availability state**

After line 177 (`const codexAvailable = isAgentAvailable(agents, "codex");`), add:
```ts
    const opencodeAvailable = isAgentAvailable(agents, "opencode");
```

After line 174 (`const [codexPopoverOpen, setCodexPopoverOpen] = useState(false);`), add:
```ts
    const [opencodePopoverOpen, setOpencodePopoverOpen] = useState(false);
```

- [ ] **Step 5: Add OpenCode entries to Run dropdown**

After the Codex sub-menu block (ending ~line 286), add before the closing `</>`:
```tsx
                                <DropdownMenuItem
                                    disabled={!opencodeAvailable}
                                    onClick={() => opencodeAvailable && onRunTab("opencode")}
                                >
                                    <OpenCodeIcon className="mr-2 h-4 w-4" />
                                    OpenCode{!opencodeAvailable ? " (not installed)" : ""}
                                </DropdownMenuItem>
                                <DropdownMenuSub>
                                    <DropdownMenuSubTrigger disabled={!opencodeAvailable}>
                                        <OpenCodeIcon className="mr-2 h-4 w-4" />
                                        OpenCode with options
                                    </DropdownMenuSubTrigger>
                                    {opencodeAvailable && (
                                        <DropdownMenuSubContent className="p-0">
                                            <AgentOptionsPanel
                                                agentType="opencode"
                                                onRun={(options) => onRunTab("opencode", options)}
                                            />
                                        </DropdownMenuSubContent>
                                    )}
                                </DropdownMenuSub>
```

- [ ] **Step 6: Add OpenCode icon button in tab bar**

After the Codex `<Popover>` block (ending ~line 357), add:
```tsx
                    <Popover open={opencodePopoverOpen} onOpenChange={setOpencodePopoverOpen}>
                        <PopoverTrigger asChild>
                            <Button
                                variant="ghost"
                                size="icon-xs"
                                className="text-opencode"
                                disabled={!opencodeAvailable}
                                onClick={(e) => {
                                    if (!opencodeAvailable) return;
                                    if (e.shiftKey) {
                                        setOpencodePopoverOpen(true);
                                    } else {
                                        onNewTab("opencode");
                                    }
                                }}
                                aria-label="New OpenCode session"
                                tooltip={opencodeAvailable ? "New OpenCode session (Shift+click for options)" : "OpenCode CLI not installed"}
                                tooltipSide="bottom"
                            >
                                <OpenCodeIcon className="h-3.5 w-3.5" />
                            </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-56 p-0">
                            <AgentOptionsPanel
                                agentType="opencode"
                                onRun={(options) => {
                                    setOpencodePopoverOpen(false);
                                    onNewTab("opencode", undefined, options);
                                }}
                            />
                        </PopoverContent>
                    </Popover>
```

- [ ] **Step 7: Commit**

```bash
git add packages/ui/src/styles/global.css packages/ui/src/components/workspace/TabBar.tsx
git commit -m "feat: add opencode to TabBar UI"
```

### Task 10: Update Workspace component

**Files:**
- Modify: `packages/ui/src/components/workspace/Workspace.tsx`

- [ ] **Step 1: Extend handleNewTab type**

At line 324-325, change:
```ts
    const handleNewTab = async (
        type: "claude" | "codex" | "browser" | "shell",
```
to:
```ts
    const handleNewTab = async (
        type: "claude" | "codex" | "opencode" | "browser" | "shell",
```

- [ ] **Step 2: Extend handleRunTab type**

At line 361, change:
```ts
    const handleRunTab = async (type: "claude" | "codex", agentOptions?: AgentLaunchOptions) => {
```
to:
```ts
    const handleRunTab = async (type: "claude" | "codex" | "opencode", agentOptions?: AgentLaunchOptions) => {
```

- [ ] **Step 3: Commit**

```bash
git add packages/ui/src/components/workspace/Workspace.tsx
git commit -m "feat: add opencode to workspace handler types"
```

### Task 11: Update NewTaskDialog

**Files:**
- Modify: `packages/ui/src/components/sidebar/NewTaskDialog.tsx`

- [ ] **Step 1: Extend startWith type in onSubmit**

At line 36, change:
```ts
        startWith?: "claude" | "codex";
```
to:
```ts
        startWith?: "claude" | "codex" | "opencode";
```

- [ ] **Step 2: Add OpenCode availability check**

After line 58 (`const codexAvailable = isAgentAvailable(agents, "codex");`), add:
```ts
    const opencodeAvailable = isAgentAvailable(agents, "opencode");
```

- [ ] **Step 3: Update handleStartWithChange guard**

At lines 69-70, add:
```ts
        if (value === "opencode" && !opencodeAvailable) return;
```

- [ ] **Step 4: Update handleSubmit startWith check**

At line 93, change:
```ts
            startWith: startWith === "claude" || startWith === "codex" ? startWith : undefined,
```
to:
```ts
            startWith: startWith === "claude" || startWith === "codex" || startWith === "opencode" ? startWith : undefined,
```

- [ ] **Step 5: Add OpenCode option to select**

After the Codex SelectItem (lines 206-208), add:
```tsx
                                <SelectItem value="opencode" disabled={!opencodeAvailable}>
                                    OpenCode{!opencodeAvailable ? " (not installed)" : ""}
                                </SelectItem>
```

- [ ] **Step 6: Update conditional AgentOptionsPanel rendering**

At line 213, change:
```ts
                    {(startWith === "claude" || startWith === "codex") && (
```
to:
```ts
                    {(startWith === "claude" || startWith === "codex" || startWith === "opencode") && (
```

And update the `agentType` prop on line 215:
```ts
                            <AgentOptionsPanel agentType={startWith as "claude" | "codex" | "opencode"} onChange={setAgentOptions} />
```

- [ ] **Step 7: Commit**

```bash
git add packages/ui/src/components/sidebar/NewTaskDialog.tsx
git commit -m "feat: add opencode to NewTaskDialog"
```

### Task 12: Update TaskCreationDialogHost

**Files:**
- Modify: `packages/ui/src/components/sidebar/TaskCreationDialogHost.tsx`

- [ ] **Step 1: Extend PendingSession type**

At line 13, change:
```ts
    type: "claude" | "codex";
```
to:
```ts
    type: "claude" | "codex" | "opencode";
```

- [ ] **Step 2: Extend handleCreateTask startWith type**

At line 83, change:
```ts
            startWith?: "claude" | "codex";
```
to:
```ts
            startWith?: "claude" | "codex" | "opencode";
```

- [ ] **Step 3: Commit**

```bash
git add packages/ui/src/components/sidebar/TaskCreationDialogHost.tsx
git commit -m "feat: add opencode to TaskCreationDialogHost"
```

### Task 13: Update SettingsModal

**Files:**
- Modify: `packages/ui/src/components/settings/SettingsModal.tsx`

- [ ] **Step 1: Extend section type and add availability**

At line 71, change:
```ts
    const [section, setSection] = useState<"general" | "defaults" | "claude" | "codex">(
```
to:
```ts
    const [section, setSection] = useState<"general" | "defaults" | "claude" | "codex" | "opencode">(
```

After line 76 (`const codexAvailable = isAgentAvailable(agents, "codex");`), add:
```ts
    const opencodeAvailable = isAgentAvailable(agents, "opencode");
```

- [ ] **Step 2: Add OpenCode settings handlers**

After `handleCodexFullAccess` (lines 157-162), add:

```ts
    const handleOpencodeModel = useCallback(
        (e: React.ChangeEvent<HTMLInputElement>) => {
            void updateSettings({ opencode: { defaultModel: e.target.value } });
        },
        [updateSettings],
    );

    const handleOpencodeFullAccess = useCallback(
        (fullAccess: boolean) => {
            void updateSettings({ opencode: { fullAccess } });
        },
        [updateSettings],
    );
```

- [ ] **Step 3: Widen handleDefaultAgent guard**

At line 127, change:
```ts
            if (value === "claude" || value === "codex") {
```
to:
```ts
            if (value === "claude" || value === "codex" || value === "opencode") {
```

- [ ] **Step 4: Add OpenCode to settings sidebar nav**

After the Codex button (lines 319-328), add:
```tsx
                        <button
                            className={`w-full rounded-md px-3 py-1.5 text-left text-sm ${
                                section === "opencode"
                                    ? "bg-accent text-accent-foreground font-medium"
                                    : "text-muted-foreground hover:text-foreground hover:bg-accent/50"
                            }`}
                            onClick={() => setSection("opencode")}
                        >
                            OpenCode
                        </button>
```

- [ ] **Step 5: Add OpenCode settings content section**

After the codex section block (ending ~line 463), add:
```tsx
                        {section === "opencode" && (
                            <>
                                <section className="space-y-2">
                                    <h3 className="mb-0 text-sm font-medium">Default Model</h3>
                                    <div className="space-y-1">
                                        <Label className={defaultsSelectLabelClassName}>
                                            Pre-selected model when running OpenCode sessions (provider/model format)
                                        </Label>
                                        <input
                                            type="text"
                                            className="bg-input border-border h-8 w-64 rounded-md border px-2 text-sm"
                                            placeholder="e.g. anthropic/claude-sonnet-4-20250514"
                                            value={settings.opencode.defaultModel}
                                            onChange={handleOpencodeModel}
                                        />
                                    </div>
                                </section>
                                <section className="space-y-2">
                                    <h3 className="mb-0 text-sm font-medium">Full Access</h3>
                                    <div className="space-y-1">
                                        <Label className={defaultsSelectLabelClassName}>
                                            Auto-approve all tool permissions by default
                                        </Label>
                                        <div className="flex items-center gap-2 pt-1">
                                            <Switch
                                                id="opencode-full-access"
                                                checked={settings.opencode.fullAccess}
                                                onCheckedChange={handleOpencodeFullAccess}
                                            />
                                            <Label
                                                htmlFor="opencode-full-access"
                                                className="cursor-pointer text-sm font-normal normal-case"
                                            >
                                                {settings.opencode.fullAccess
                                                    ? "Enabled"
                                                    : "Disabled"}
                                            </Label>
                                        </div>
                                    </div>
                                </section>
                            </>
                        )}
```

- [ ] **Step 6: Add OpenCode to default agent select**

After the Codex SelectItem (lines 507-509), add:
```tsx
                                                <SelectItem value="opencode" disabled={!opencodeAvailable}>
                                                    OpenCode{!opencodeAvailable ? " (not installed)" : ""}
                                                </SelectItem>
```

- [ ] **Step 7: Commit**

```bash
git add packages/ui/src/components/settings/SettingsModal.tsx
git commit -m "feat: add opencode settings section"
```

### Task 14: Final verification

- [ ] **Step 1: Full type check**

Run: `cd /Users/kuindji/Projects/taskflow/.worktrees/add-opencode-agent-support && bun tsc --noEmit`
Expected: No type errors.

- [ ] **Step 2: Lint check**

Run: `cd /Users/kuindji/Projects/taskflow/.worktrees/add-opencode-agent-support && bun lint`
Expected: No new lint errors.

- [ ] **Step 3: Fix any issues found**

If there are type or lint errors, fix them and commit.
