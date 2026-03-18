# Favorite Agents Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users pick favorite agents in Settings; favorites get toolbar buttons, others go to the combined shell dropdown.

**Architecture:** Add `favoriteAgents: AgentType[]` to `GeneralSettings`, default to all agents. Settings UI gets toggle switches. TabBar renders agent buttons from a data-driven loop filtered by favorites, and merges non-favorites into the shell dropdown. The Run menu is also refactored to use the same data-driven approach with `AGENT_META`.

**Tech Stack:** React, Zustand, TypeScript, shadcn/ui components

**Note:** `packages/ui/src/stores/settings-store.ts` is listed in the spec as "Files to Modify" but requires no changes — the backend handles default merging via `createDefaultSettings()`. The UI store just proxies settings via WebSocket.

---

### Task 1: Add `ALL_AGENT_TYPES` constant and agent display name utility

**Files:**
- Modify: `packages/shared/src/types/agent.ts`

- [ ] **Step 1: Add the constant and export it**

In `packages/shared/src/types/agent.ts`, add after line 1 (after the `AgentType` type declaration):

```typescript
const ALL_AGENT_TYPES: AgentType[] = ["claude", "codex", "opencode", "gemini", "cursor"];
```

**Important:** The existing file uses `export type { ... }` at the bottom (lines 46-55) which cannot export values. Add a **separate** value export statement — do NOT add `ALL_AGENT_TYPES` inside the `export type { ... }` block:

```typescript
export { ALL_AGENT_TYPES };

export type {
    AgentType,
    // ... rest unchanged
};
```

Also add an agent display name map that can be shared across components (avoids duplicating display name logic):

```typescript
const AGENT_DISPLAY_NAMES: Record<AgentType, string> = {
    claude: "Claude",
    codex: "Codex",
    opencode: "OpenCode",
    gemini: "Gemini",
    cursor: "Cursor",
};
```

Add `AGENT_DISPLAY_NAMES` to the value export:

```typescript
export { ALL_AGENT_TYPES, AGENT_DISPLAY_NAMES };
```

- [ ] **Step 2: Verify build**

Run: `cd /Users/kuindji/Projects/taskflow && bun run build:shared`
Expected: Clean build, no errors

- [ ] **Step 3: Commit**

```bash
git add packages/shared/src/types/agent.ts
git commit -m "feat: add ALL_AGENT_TYPES constant and AGENT_DISPLAY_NAMES map"
```

---

### Task 2: Add `favoriteAgents` to settings types and backend defaults

**Files:**
- Modify: `packages/shared/src/types/settings.ts:2-8` (GeneralSettings interface)
- Modify: `packages/backend/src/services/settings-store.ts:2-23` (imports and DEFAULTS)

- [ ] **Step 1: Add `favoriteAgents` to `GeneralSettings`**

In `packages/shared/src/types/settings.ts`, add the new field to the `GeneralSettings` interface (lines 2-8):

```typescript
export interface GeneralSettings {
    fontFamily: string;
    fontSize: number;
    defaultAgent: AgentType;
    defaultRuntime: string;
    favoriteAgents: AgentType[];
}
```

- [ ] **Step 2: Update backend defaults**

In `packages/backend/src/services/settings-store.ts`, add `ALL_AGENT_TYPES` to the import from `@taskflow/shared` (lines 2-9):

```typescript
import {
    DEFAULT_EDITOR_FONT_FAMILY,
    DEFAULT_EDITOR_FONT_SIZE,
    DEFAULT_EDITOR_WORD_WRAP,
    DEFAULT_TERMINAL_FONT_FAMILY,
    DEFAULT_TERMINAL_SHELL,
    DEFAULT_THEME_ID,
    ALL_AGENT_TYPES,
} from "@taskflow/shared";
```

Update the `general` section of `DEFAULTS` (lines 18-23) to include `favoriteAgents`:

```typescript
general: {
    fontFamily: "CaskaydiaCove Nerd Font Mono, monospace",
    fontSize: 13,
    defaultAgent: "claude",
    defaultRuntime: "bun",
    favoriteAgents: [...ALL_AGENT_TYPES],
},
```

- [ ] **Step 3: Verify build**

Run: `cd /Users/kuindji/Projects/taskflow && bun run build:shared && bun run build:backend`
Expected: Clean build, no errors

- [ ] **Step 4: Commit**

```bash
git add packages/shared/src/types/settings.ts packages/backend/src/services/settings-store.ts
git commit -m "feat: add favoriteAgents field to GeneralSettings with ALL_AGENT_TYPES default"
```

---

### Task 3: Add favorite agent toggles to Settings UI

**Files:**
- Modify: `packages/ui/src/components/settings/SettingsModal.tsx`

- [ ] **Step 1: Add imports**

In `SettingsModal.tsx`, update the `@taskflow/shared` import block (lines 20-31) to also import `ALL_AGENT_TYPES`, `AGENT_DISPLAY_NAMES`, and `AgentType`:

```typescript
import {
    DEFAULT_TERMINAL_SHELL,
    MSG,
    ALL_AGENT_TYPES,
    AGENT_DISPLAY_NAMES,
    type AgentType,
    type ShellInfo,
    type ShellListResponse,
    type RuntimeInfo,
    type RuntimeListResponse,
    type ClaudeSettings,
    type GeminiSettings,
    type EditorInfo,
    type SystemInfoResponse,
} from "@taskflow/shared";
```

- [ ] **Step 2: Add the toggle handler**

Add a `handleToggleFavoriteAgent` callback after `handleDefaultAgent` (after line 131):

```typescript
const handleToggleFavoriteAgent = useCallback(
    (agent: AgentType, checked: boolean) => {
        const current = settings?.general.favoriteAgents ?? ALL_AGENT_TYPES;
        const next = checked
            ? [...current, agent]
            : current.filter((a) => a !== agent);
        void updateSettings({ general: { favoriteAgents: next } });
    },
    [settings?.general.favoriteAgents, updateSettings],
);
```

- [ ] **Step 3: Add the Toolbar Agents section in the Defaults tab**

After the "Default Agent" `</SettingRow>` closing tag (line 495), before the "Default Shell" `<SettingRow>` (line 496), insert:

```tsx
<div className="hover:bg-island-base mx-1 flex flex-col gap-1 rounded-md px-5 py-3 transition-colors">
    <div>
        <div className="text-secondary-foreground text-[13px] font-medium">
            Toolbar Agents
        </div>
        <div className="text-muted-foreground text-[11px] leading-snug">
            Favorited agents appear as buttons in the workspace toolbar
        </div>
    </div>
    {ALL_AGENT_TYPES.filter(
        (agent) => isAgentAvailable(agents, agent),
    ).map((agent) => (
        <div
            key={agent}
            className="flex items-center justify-between py-0.5">
            <Label
                htmlFor={`toolbar-agent-${agent}`}
                className="text-secondary-foreground cursor-pointer text-[13px] font-normal normal-case">
                {AGENT_DISPLAY_NAMES[agent]}
            </Label>
            <Switch
                id={`toolbar-agent-${agent}`}
                checked={(
                    settings.general.favoriteAgents ?? ALL_AGENT_TYPES
                ).includes(agent)}
                onCheckedChange={(checked) =>
                    handleToggleFavoriteAgent(agent, checked)
                }
            />
        </div>
    ))}
</div>
```

Note: This uses a `<div>` wrapper instead of `<SettingRow>` because `SettingRow` is a single label+control row. The Toolbar Agents section contains multiple toggle rows under one heading, requiring the vertical flex layout.

- [ ] **Step 4: Verify build**

Run: `cd /Users/kuindji/Projects/taskflow && bun run build:ui`
Expected: Clean build, no errors

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/components/settings/SettingsModal.tsx
git commit -m "feat: add toolbar agents toggle section to Settings Defaults tab"
```

---

### Task 4: Refactor TabBar to data-driven agent buttons, Run menu, and combined dropdown

This is the main task. It modifies the TabBar component to:
1. Use `AGENT_META` lookup for icons/colors/labels
2. Replace 5 individual popover states with one
3. Render favorite agent buttons from a loop
4. Refactor the Run menu to use `AGENT_META` and inline availability
5. Add non-favorite agents to the combined dropdown

**Files:**
- Modify: `packages/ui/src/components/workspace/TabBar.tsx`

- [ ] **Step 1: Update imports**

Add `ALL_AGENT_TYPES`, `AGENT_DISPLAY_NAMES`, and `AgentType` to the `@taskflow/shared` import (line 13):

```typescript
import {
    DEFAULT_TERMINAL_SHELL,
    MSG,
    ALL_AGENT_TYPES,
    AGENT_DISPLAY_NAMES,
    type AgentType,
    type ShellListResponse,
} from "@taskflow/shared";
```

- [ ] **Step 2: Add AGENT_META lookup**

Add after the imports (after line 43), before `tabVariants`:

```typescript
const AGENT_META: Record<
    AgentType,
    {
        icon: React.ComponentType<{ className?: string }>;
        colorClass: string;
    }
> = {
    claude: { icon: ClaudeIcon, colorClass: "text-warning" },
    codex: { icon: CodexIcon, colorClass: "text-success" },
    opencode: { icon: OpenCodeIcon, colorClass: "text-opencode" },
    gemini: { icon: GeminiIcon, colorClass: "text-primary" },
    cursor: { icon: CursorIcon, colorClass: "text-cursor-agent" },
};
```

Uses `AGENT_DISPLAY_NAMES` from shared for labels, and `AGENT_META` only for icon/color which are UI-only concerns.

- [ ] **Step 3: Replace individual popover and availability states**

Replace lines 209-219:

```typescript
const [claudePopoverOpen, setClaudePopoverOpen] = useState(false);
const [codexPopoverOpen, setCodexPopoverOpen] = useState(false);
const [opencodePopoverOpen, setOpencodePopoverOpen] = useState(false);
const [geminiPopoverOpen, setGeminiPopoverOpen] = useState(false);
const [cursorPopoverOpen, setCursorPopoverOpen] = useState(false);
const agents = useAgentAvailability();
const claudeAvailable = isAgentAvailable(agents, "claude");
const codexAvailable = isAgentAvailable(agents, "codex");
const opencodeAvailable = isAgentAvailable(agents, "opencode");
const geminiAvailable = isAgentAvailable(agents, "gemini");
const cursorAvailable = isAgentAvailable(agents, "cursor");
```

With:

```typescript
const [openAgentPopover, setOpenAgentPopover] = useState<AgentType | null>(null);
const agents = useAgentAvailability();
```

- [ ] **Step 4: Add favorites and non-favorites selectors**

After the `configuredShell` selector (lines 220-222), add:

```typescript
const favoriteAgents = useSettingsStore(
    (s) => s.settings?.general.favoriteAgents ?? ALL_AGENT_TYPES,
);
const nonFavoriteAgents = useMemo(
    () => ALL_AGENT_TYPES.filter((agent) => !favoriteAgents.includes(agent)),
    [favoriteAgents],
);
```

- [ ] **Step 5: Refactor the Run menu agent section**

Replace the Run menu agent section (lines 331-437, the `{showAgentOptions && (<>...</>)}` block) with a data-driven version:

```tsx
{showAgentOptions && (
    <>
        {(scriptNames.length > 0 ||
            flows.length > 0 ||
            standaloneActions.length > 0) && <DropdownMenuSeparator />}
        <DropdownMenuLabel>Run agent with task description</DropdownMenuLabel>
        {ALL_AGENT_TYPES.map((agentType) => {
            const meta = AGENT_META[agentType];
            const available = isAgentAvailable(agents, agentType);
            const Icon = meta.icon;
            const label = AGENT_DISPLAY_NAMES[agentType];
            return (
                <React.Fragment key={agentType}>
                    <DropdownMenuItem
                        disabled={!available}
                        onClick={() =>
                            available && onRunTab(agentType)
                        }>
                        <Icon className="mr-2 h-4 w-4" />
                        {label}
                        {!available ? " (not installed)" : ""}
                    </DropdownMenuItem>
                    <DropdownMenuSub>
                        <DropdownMenuSubTrigger
                            disabled={!available}>
                            <Icon className="mr-2 h-4 w-4" />
                            {label} with options
                        </DropdownMenuSubTrigger>
                        {available && (
                            <DropdownMenuSubContent className="p-0">
                                <AgentOptionsPanel
                                    agentType={agentType}
                                    onRun={(options) =>
                                        onRunTab(
                                            agentType,
                                            options,
                                        )
                                    }
                                />
                            </DropdownMenuSubContent>
                        )}
                    </DropdownMenuSub>
                </React.Fragment>
            );
        })}
    </>
)}
```

Ensure `React` is imported at the top of the file (it should already be, since hooks are imported from "react"). If `React` is not imported as a namespace, add: `import React from "react";` — or use `<Fragment>` from the existing import. Check the existing import on line 1: `import { useMemo, useEffect, useState, useRef, useCallback } from "react";` — add `Fragment` to this import and use `<Fragment>` instead of `<React.Fragment>`.

Updated import:
```typescript
import { useMemo, useEffect, useState, useRef, useCallback, Fragment } from "react";
```

And use `<Fragment key={agentType}>` instead of `<React.Fragment key={agentType}>`.

- [ ] **Step 6: Replace the 5 individual agent button blocks with a data-driven loop**

Replace lines 442-625 (the entire `{allowSessionTabs && (<>...</>)}` block, including the closing `)}` on line 625) with:

```tsx
{allowSessionTabs && (
    <>
        {favoriteAgents.map((agentType) => {
            const meta = AGENT_META[agentType];
            const available = isAgentAvailable(agents, agentType);
            const Icon = meta.icon;
            const label = AGENT_DISPLAY_NAMES[agentType];
            return (
                <Popover
                    key={agentType}
                    open={openAgentPopover === agentType}
                    onOpenChange={(open) =>
                        setOpenAgentPopover(open ? agentType : null)
                    }>
                    <PopoverTrigger asChild>
                        <Button
                            variant="ghost"
                            size="icon-xs"
                            className={meta.colorClass}
                            disabled={!available}
                            onClick={(e) => {
                                e.preventDefault();
                                if (!available) return;
                                if (e.shiftKey) {
                                    setOpenAgentPopover(agentType);
                                } else {
                                    onNewTab(agentType);
                                }
                            }}
                            aria-label={`New ${label} session`}
                            tooltip={
                                available
                                    ? `New ${label} session (Shift+click for options)`
                                    : `${label} CLI not installed`
                            }
                            tooltipSide="bottom">
                            <Icon className="h-3.5 w-3.5" />
                        </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-56 p-0">
                        <AgentOptionsPanel
                            agentType={agentType}
                            onRun={(options) => {
                                setOpenAgentPopover(null);
                                onNewTab(agentType, undefined, options);
                            }}
                        />
                    </PopoverContent>
                </Popover>
            );
        })}
    </>
)}
```

- [ ] **Step 7: Update the shell dropdown to include non-favorite agents**

Replace the shell dropdown block (lines 651-689, the `{shells.length > 1 && (<DropdownMenu>...</DropdownMenu>)}` block) with:

```tsx
{((nonFavoriteAgents.length > 0 && allowSessionTabs) ||
    shells.length > 1) && (
    <DropdownMenu>
        <DropdownMenuTrigger asChild>
            <Button
                variant="ghost"
                size="icon-xs"
                aria-label="More options"
                tooltip="More options"
                tooltipSide="bottom">
                <ChevronDown className="h-3.5 w-3.5" />
            </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
            {allowSessionTabs &&
                nonFavoriteAgents.map((agentType) => {
                    const meta = AGENT_META[agentType];
                    const available = isAgentAvailable(
                        agents,
                        agentType,
                    );
                    const Icon = meta.icon;
                    return (
                        <DropdownMenuItem
                            key={agentType}
                            disabled={!available}
                            onClick={() => {
                                if (available)
                                    onNewTab(agentType);
                            }}>
                            <Icon className="mr-2 h-4 w-4" />
                            {AGENT_DISPLAY_NAMES[agentType]}
                            {!available && (
                                <span className="text-muted-foreground ml-auto text-xs">
                                    not installed
                                </span>
                            )}
                        </DropdownMenuItem>
                    );
                })}
            {nonFavoriteAgents.length > 0 &&
                allowSessionTabs &&
                shells.length > 1 && (
                    <DropdownMenuSeparator />
                )}
            {shells.length > 1 && (
                <>
                    <DropdownMenuItem
                        disabled={!defaultShellPath}
                        onClick={() => {
                            if (defaultShellPath)
                                onNewTab(
                                    "shell",
                                    defaultShellPath,
                                );
                        }}>
                        <Terminal className="mr-2 h-4 w-4" />
                        Default Terminal
                        <span className="text-muted-foreground ml-auto text-xs">
                            {configuredShell ===
                            DEFAULT_TERMINAL_SHELL
                                ? getShellNameFromPath(
                                      defaultShellPath ??
                                          systemShellPath ??
                                          "",
                                  )
                                : defaultShellSummary}
                        </span>
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    {shells.map((shell) => (
                        <DropdownMenuItem
                            key={shell.path}
                            onClick={() =>
                                onNewTab("shell", shell.path)
                            }>
                            <Terminal className="mr-2 h-4 w-4" />
                            {getShellDisplayName(shell)}
                        </DropdownMenuItem>
                    ))}
                </>
            )}
        </DropdownMenuContent>
    </DropdownMenu>
)}
```

- [ ] **Step 8: Verify build**

Run: `cd /Users/kuindji/Projects/taskflow && bun run build:ui`
Expected: Clean build, no errors

- [ ] **Step 9: Lint check**

Run: `cd /Users/kuindji/Projects/taskflow && bun run lint`
Expected: No new lint errors

- [ ] **Step 10: Manual test**

1. Open Taskflow, go to Settings > Defaults
2. Toggle off one agent (e.g., Cursor) — its toolbar button should disappear
3. Click the chevron dropdown — Cursor should appear in the dropdown above shells
4. Click Cursor in dropdown — should create a new session
5. Toggle all agents off — all agents appear in dropdown, no agent buttons in toolbar
6. Toggle all agents on — dropdown reverts to shell-only (or hidden if single shell)
7. Verify the Run menu still shows all agents regardless of favorite status
8. Verify shift+click on favorite agent toolbar buttons still opens options popover

- [ ] **Step 11: Commit**

```bash
git add packages/ui/src/components/workspace/TabBar.tsx
git commit -m "feat: data-driven agent buttons with favorites and combined dropdown"
```
