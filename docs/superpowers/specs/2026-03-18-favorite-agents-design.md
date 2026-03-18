# Favorite Agents — Design Spec

## Overview

Allow users to select favorite agents in Settings. Favorited agents get dedicated toolbar buttons in the workspace TabBar. Non-favorited agents move into the combined shell/terminal dropdown.

## Data Model

### `AgentType` constant (packages/shared/src/types/agent.ts)

Add a canonical list of all agent types to avoid hardcoded literals drifting:

```typescript
const ALL_AGENT_TYPES: AgentType[] = ["claude", "codex", "opencode", "gemini", "cursor"];
```

Export this constant. Use it as the default value for `favoriteAgents` and anywhere else that currently enumerates agents manually.

### `GeneralSettings` (packages/shared/src/types/settings.ts)

Add one field:

```typescript
favoriteAgents: AgentType[]
```

- Default value: `ALL_AGENT_TYPES` (imported from agent.ts)
- Preserves current behavior for existing users — all agents show as toolbar buttons until the user customizes
- No migration needed: when the field is absent from stored settings, the settings store's `getDefaults()` provides the full array

## Settings UI

### Location

Settings Modal → Defaults tab, below the existing "Default Agent" dropdown row. This tab already contains Default Agent, Default Shell, and Default Runtime — toolbar agent visibility is in the same category of "which agents/tools are readily accessible."

### Layout

New section titled **"Toolbar Agents"** with hint text: *"Favorited agents appear as buttons in the workspace toolbar"*

One `SettingRow` per available agent:
- Agent name (plain text, no icon/dot)
- Toggle `Switch` (on = favorite = toolbar button)
- Each switch gets a proper `id` for `<Label htmlFor>` accessibility (e.g., `id="toolbar-agent-claude"`)

Toggling a switch updates `settings.general.favoriteAgents` via `updateSettings()`.

The toggle list follows the same availability behavior as the existing Default Agent dropdown: agents appear based on `useAgentAvailability()`, which shows all agents as available until the agent list loads from backend.

### No constraint on default agent

The default agent setting is independent of toolbar visibility. A user can unfavorite the default agent — it still works as the pre-selected agent for new tasks.

## TabBar Changes

### File: packages/ui/src/components/workspace/TabBar.tsx

#### Favorite agent buttons

Currently all 5 agents render as individual `<Popover>` + `<Button>` blocks with dedicated `useState` for each popover. Change to:

- Read `favoriteAgents` from settings store
- Render agent buttons from a data-driven loop over `favoriteAgents` (filtered to available agents)
- Replace the 5 individual `useState` popover booleans with a single `openAgentPopover: AgentType | null` state
- Each button's shift+click sets `openAgentPopover` to its agent type; closing sets it to `null`
- Agent metadata (icon component, color class, display name) extracted into a lookup object to support the loop
- All wrapped in `{allowSessionTabs && (...)}` as before

#### Combined dropdown

The existing shell chevron dropdown becomes a combined dropdown. Structure:

```
┌─────────────────────────┐
│  Claude                 │  ← non-favorite available agents
│  Codex                  │
│ ─────────────────────── │  ← separator (only if both sections present)
│ 🖥 Default Terminal  zsh│  ← existing shell items
│ 🖥 /bin/bash            │
│ 🖥 /bin/zsh             │
└─────────────────────────┘
```

- Non-favorite agent items use agent icons (same components as toolbar buttons) and display names
- Clicking a non-favorite agent calls `onNewTab(agentType)` — same as toolbar buttons
- Unavailable non-favorite agents shown as disabled items (consistent with toolbar button behavior)
- No shift+click options support in dropdown — options available via Run menu

#### Dropdown visibility logic

Current: `shells.length > 1`

New: `(hasNonFavoriteAgents && allowSessionTabs) || shells.length > 1`

Where `hasNonFavoriteAgents` = at least one available agent is not in `favoriteAgents`.

The non-favorite agents section within the dropdown is also guarded by `allowSessionTabs` — if sessions can't be created, the agents section is hidden (shells section still shows independently).

## Files to Modify

1. **packages/shared/src/types/agent.ts** — Add and export `ALL_AGENT_TYPES` constant
2. **packages/shared/src/types/settings.ts** — Add `favoriteAgents` to `GeneralSettings`
3. **packages/backend/src/services/settings-store.ts** — Use `ALL_AGENT_TYPES` as default value for `favoriteAgents` in `getDefaults()`
4. **packages/ui/src/stores/settings-store.ts** — Ensure default merging covers new field
5. **packages/ui/src/components/settings/SettingsModal.tsx** — Add Toolbar Agents toggle section in Defaults tab
6. **packages/ui/src/components/workspace/TabBar.tsx** — Data-driven agent buttons with single popover state, combined dropdown with non-favorites

## Unchanged

- **Run menu** — Always shows all available agents regardless of favorites
- **New Task dialog** — Always shows all available agents
- **AgentOptionsPanel** — Unchanged
- **Agent detection / availability** — Unchanged

## Edge Cases

- **No favorites selected**: No agent buttons in toolbar. All available agents appear in the dropdown. Terminal and browser buttons remain.
- **All favorites selected**: Current behavior. Dropdown reverts to current shell-only visibility logic.
- **Agent becomes unavailable**: Toolbar buttons for unavailable favorites render as disabled (current behavior). Unavailable non-favorites show as disabled in dropdown.
- **New agent type added in future**: Add it to `ALL_AGENT_TYPES` in agent.ts. Existing users without the new type in their saved `favoriteAgents` won't see it as a toolbar button until they add it in Settings. New installs get all agents as favorites by default.
- **`allowSessionTabs` is false**: No agent buttons rendered (current behavior). Non-favorite agents section hidden from dropdown.
