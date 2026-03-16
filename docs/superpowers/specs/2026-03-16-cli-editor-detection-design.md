# CLI Editor Detection & Internal Editor Setting

## Problem

The app currently uses Monaco as the only internal editor. Users who prefer CLI editors like Neovim or Vim have no way to use them inside the app — they must switch to an external terminal. CLI editors like `nvim` and `emacs` are incorrectly grouped with GUI editors (VS Code, Cursor) in the "external editor" setting, but they can't meaningfully open as external apps.

## Solution

Split editors into two categories:

- **Internal editors**: Monaco (default) + detected CLI editors (nvim, vim, nano, helix, micro, emacs -nw)
- **External editors**: GUI apps launched as separate OS windows (VS Code, Cursor, Zed, Sublime, Windsurf, WebStorm, IntelliJ)

Add a new "Internal Editor" setting. When a CLI editor is selected, opening a file spawns a terminal session running that editor instead of showing Monaco.

## Design

### Types & Settings

**`packages/shared/src/types/system.ts`** — extend `EditorInfo`:

```typescript
interface EditorInfo {
  id: string;
  name: string;
  command: string;
  type: "internal" | "external";
  // Format string for line navigation. Uses {line} and {file} placeholders.
  // Examples: "+{line}" (vim-style), "{file}:{line}" (helix-style)
  // When lineFlag contains {file}, the file path is embedded in the flag itself
  // and must NOT be passed as a separate argument.
  lineFlag?: string;
  // Extra args always passed, e.g. ["-nw"] for emacs
  extraArgs?: string[];
}
```

**`packages/shared/src/types/settings.ts`** — modify `EditorSettings`:

```typescript
interface EditorSettings {
  fontFamily: string;
  fontSize: number;
  wordWrap: boolean;
  internalEditor: string; // "monaco" or a CLI editor id
  externalEditor: string; // moved from GeneralSettings for symmetry
}
```

Remove `externalEditor` from `GeneralSettings`. Default `internalEditor`: `"monaco"`.

### Editor Detection

**`packages/backend/src/services/editor-detector.ts`** — two detection lists:

Internal CLI editors (detected via `Bun.which()`):

| ID | Name | Command | Line Flag | Extra Args |
|----|------|---------|-----------|------------|
| nvim | Neovim | nvim | +{line} | — |
| vim | Vim | vim | +{line} | — |
| nano | Nano | nano | +{line} | — |
| helix | Helix | hx | {file}:{line} | — |
| micro | Micro | micro | +{line} | — |
| emacs | Emacs | emacs | +{line} | ["-nw"] |

External GUI editors (existing, minus emacs):

| ID | Name | Command |
|----|------|---------|
| vscode | VS Code | code |
| cursor | Cursor | cursor |
| zed | Zed | zed |
| sublime | Sublime Text | subl |
| windsurf | Windsurf | windsurf |
| webstorm | WebStorm | webstorm |
| idea | IntelliJ IDEA | idea |

The detector returns `EditorInfo[]` with the `type` field set accordingly. `SystemInfo.editors` carries this to the frontend.

### Backend: Editor Session Creation

**`packages/backend/src/services/session-lifecycle.ts`** — handle editor sessions:

Add `"editor"` to the `CreateSessionOpts.type` union.

When `SESSION_CREATE` is called with `type: "editor"`:
1. Look up the CLI editor by ID from the detected editors list
2. Build command args using a general substitution rule:
   - Replace `{line}` with the line number and `{file}` with the file path in `lineFlag`
   - If `lineFlag` contains `{file}`, the resolved flag is the only arg after extraArgs (file is embedded)
   - Otherwise, args are: `[command, ...extraArgs, resolvedLineFlag, filePath]`
   - If no line number provided, skip the lineFlag entirely: `[command, ...extraArgs, filePath]`
3. Spawn via `ptyManager.spawn()` with the project root as cwd
4. Tab stays open after the editor process exits (standard PTY behavior)

**`packages/backend/src/handlers/session.ts`** — accept new fields in `SESSION_CREATE`:
- `editorId`: string — which CLI editor to use
- `filePath`: string — file to open
- `line`: number (optional) — line to jump to

(`col` is intentionally omitted — no CLI editor has a clean universal column flag.)

### Frontend: File Opening Flow

**`packages/ui/src/components/panes/TerminalPane.tsx`** — modify `openFileInApp()`:

The function signature must accept `owner` (taskId or projectId) so it can call `createSession`. Currently it only receives `workspaceKey`. Update callers to pass the owner through.

```
if internalEditor === "monaco":
  → current behavior: addTab with type "editor", renders MonacoEditorPane
else:
  → createSession with type "editor", editorId, filePath, line
  → the session creation returns a sessionId
  → addTab with type "editor", sessionId set, label: "nvim: filename.ts"
  → TabContent renders TerminalPane for editor tabs that have a sessionId
```

**`packages/ui/src/stores/session-store.ts`** — extend `createSession()`:
- Accept optional `editorId`, `filePath`, `line` params
- Forward to backend via `SESSION_CREATE`

### Frontend: Tab Rendering

**`packages/ui/src/components/workspace/TabContent.tsx`**:
- Editor tabs (`type: "editor"`) that have a `sessionId` render `TerminalPane` (CLI editor)
- Editor tabs without a `sessionId` render `EditorPane` (Monaco) — current behavior
- This discriminator is clean and survives `syncWithTasks` because both `type` and `sessionId` are stored in `SessionRef`

### Frontend: Settings UI

**`packages/ui/src/components/settings/SettingsModal.tsx`**:
- Add "Internal Editor" dropdown in editor settings section
- Options: "Monaco" (always) + detected CLI editors from `SYSTEM_INFO` where `type === "internal"`
- Remove emacs from the external editor dropdown
- External editor dropdown only shows editors where `type === "external"` + "System Default"
- Move the external editor dropdown from General to Editor section

### Edge Cases

**Editor uninstalled after selection:** If the selected `internalEditor` is not found in `SystemInfo.editors`, fall back to Monaco. The settings UI should show the current value as invalid/missing and default behavior uses Monaco.

**Settings migration:** The backend settings store merges with defaults on load. New `internalEditor` field defaults to `"monaco"`. Moving `externalEditor` from `GeneralSettings` to `EditorSettings` requires a one-time migration in the settings store load logic — if `general.externalEditor` exists, copy it to `editor.externalEditor` and delete the old key.

**Label preservation:** CLI editor tab labels (e.g., `"nvim: config.ts"`) are stored in `SessionRef.label`. The existing `normalizeSessionLabel` function preserves non-default labels, so these survive `syncWithTasks`/`syncWithProjects` without changes.

## Out of Scope

- Per-file-type editor mapping
- "Open with..." context menu
- Editor plugin/extension management
- Embedded terminal multiplexing
- Column navigation (no universal CLI editor support)
