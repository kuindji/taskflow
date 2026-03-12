# Settings Window Sections

## Overview

Refactor the settings modal from a flat vertically-stacked layout into a sidebar-navigated sectioned layout. Add new default settings: default agent and default runtime.

## Layout

The settings dialog uses a two-panel layout:

- **Left sidebar** (~160px): vertical list of section names. Active section highlighted. Clicking a section switches the right panel content.
- **Right content panel**: displays the active section's settings. Only one section visible at a time.
- Section state is local to the component (no store needed).
- Dialog width bumped to ~48rem to accommodate the sidebar comfortably.

## Sections

### Fonts

Contains all font-related settings, same controls as the current implementation:

- **Application Font** — family (FontFamilySelect) + size (number input, 8-32)
- **Terminal Font** — family (FontFamilySelect) + size (number input, 8-32)
- **Editor Font** — family (FontFamilySelect) + size (number input, 8-32)

### Defaults

Contains all default behavior settings:

- **External Editor** — dropdown with editor options (system, vscode, cursor, windsurf, zed, sublime, webstorm, idea, emacs). Existing logic, moved from top-level.
- **Default Agent** — dropdown: Claude, Codex. Affects new task dialog pre-selection, run button default, title generation, and commit message generation. Default: `"claude"`.
- **Default Shell** — dropdown with detected shells. Existing logic, moved from Terminal Font section. Uses existing `SHELLS_LIST` WebSocket message.
- **Default Runtime** — dropdown: bun, node (only shows installed). Detected on backend via PATH lookup. Default: `"bun"`. Used for executing scripts and commands.

## Type Changes

### `packages/shared/src/types/settings.ts`

Add to `GeneralSettings`:
```ts
defaultAgent: "claude" | "codex";
defaultRuntime: string;
```

Add `SettingsUpdatePayload.general` gains the same optional fields via `Partial<GeneralSettings>`.

### `packages/shared/src/types/agent.ts`

Export agent type string literal as a reusable type:
```ts
type AgentType = "claude" | "codex";
```

Use `AgentType` in `GeneralSettings` and `AgentLaunchOptions`.

## Backend Changes

### Runtime Detection

New WebSocket message `MSG.RUNTIMES_LIST` (pattern follows `SHELLS_LIST`):

- Handler checks for `bun` and `node` on PATH using `Bun.which()` or equivalent.
- Returns list of `{ name: string; path: string; version: string }` objects for each detected runtime.
- Called by the UI when the settings modal opens (same pattern as shell list fetching).

New shared types:
```ts
interface RuntimeInfo {
    name: string;
    path: string;
    version: string;
}

interface RuntimeListResponse {
    runtimes: RuntimeInfo[];
}
```

### Default Settings

Update `DEFAULT_SETTINGS` in backend settings store:
- `general.defaultAgent`: `"claude"`
- `general.defaultRuntime`: `"bun"`

## UI Changes

### `SettingsModal.tsx`

Refactored structure:

```
Dialog
├── DialogHeader (title + description)
└── div (flex layout)
    ├── Sidebar (section list)
    │   ├── "Fonts" (button)
    │   └── "Defaults" (button)
    └── Content Panel
        ├── FontsSection (when active)
        └── DefaultsSection (when active)
```

- Active section tracked via `useState<"fonts" | "defaults">("fonts")`.
- Sections can be inline within SettingsModal or extracted into sibling components in the settings directory — keep it simple, extract only if the file gets unwieldy.
- Dialog width changes from `42rem` to `48rem`.

### DefaultsSection Content

- External Editor: existing `Select` with `EDITOR_OPTIONS`
- Default Agent: new `Select` with options `[{value: "claude", label: "Claude"}, {value: "codex", label: "Codex"}]`
- Default Shell: existing shell select logic (fetches via `SHELLS_LIST`)
- Default Runtime: new `Select` populated from `RUNTIMES_LIST` response. Shows runtime name. If only one runtime detected, still show dropdown but with single option.

## Migration

Existing settings files without the new fields will get defaults via the existing partial-merge strategy in the backend settings store. No migration code needed.

## Out of Scope

- Default model selection for Claude (future consideration)
- Consuming `defaultAgent` / `defaultRuntime` in task creation, title generation, etc. (those call sites will be updated separately)
