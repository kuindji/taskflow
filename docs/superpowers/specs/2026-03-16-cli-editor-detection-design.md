# CLI Editor Detection & Internal Editor Setting

## Problem

The app currently uses Monaco as the only internal editor. Users who prefer CLI editors like Neovim or Vim have no way to use them inside the app — they must switch to an external terminal. CLI editors like `nvim` are incorrectly grouped with GUI editors (VS Code, Cursor) in the "external editor" setting, but they can't meaningfully open as external apps.

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
  // Format string for line navigation, e.g. "+{line}" or "{file}:{line}"
  lineFlag?: string;
  // Extra args always passed, e.g. ["-nw"] for emacs
  extraArgs?: string[];
}
```

**`packages/shared/src/types/settings.ts`** — add to `EditorSettings`:

```typescript
interface EditorSettings {
  fontFamily: string;
  fontSize: number;
  wordWrap: boolean;
  internalEditor: string; // "monaco" or a CLI editor id
}
```

Default: `"monaco"`.

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

The detector returns `EditorInfo[]` with the `type` field set accordingly. `SystemInfo.editors` already carries this to the frontend.

### Backend: Editor Session Creation

**`packages/backend/src/services/session-lifecycle.ts`** — handle editor sessions:

When `SESSION_CREATE` is called with `type: "editor"`:
1. Look up the CLI editor by ID from the detected editors list
2. Build command args: `[command, ...extraArgs, lineFlag, filePath]`
   - For helix (special line format): `[hx, "file:line"]`
   - For others: `[editor, ...extraArgs, +line, file]`
3. Spawn via `ptyManager.spawn()` with the project root as cwd
4. Tab stays open after the editor process exits (standard PTY behavior)

**`packages/backend/src/handlers/session.ts`** — accept new fields in `SESSION_CREATE`:
- `editorId`: string — which CLI editor to use
- `filePath`: string — file to open
- `line`: number (optional) — line to jump to
- `col`: number (optional) — column to jump to

### Frontend: File Opening Flow

**`packages/ui/src/components/panes/TerminalPane.tsx`** — modify `openFileInApp()`:

```
if internalEditor === "monaco":
  → current behavior: addTab with type "editor", renders MonacoEditorPane
else:
  → createSession with type "editor", editorId, filePath, line
  → addTab with type "shell", label: "nvim: filename.ts"
  → tab renders TerminalPane (standard terminal session)
```

**`packages/ui/src/stores/session-store.ts`** — extend `createSession()`:
- Accept optional `editorId`, `filePath`, `line`, `col` params
- Forward to backend via `SESSION_CREATE`

### Frontend: Settings UI

**`packages/ui/src/components/settings/SettingsModal.tsx`**:
- Add "Internal Editor" dropdown in editor settings section
- Options: "Monaco" (always) + detected CLI editors from `SYSTEM_INFO` where `type === "internal"`
- Remove emacs from the external editor dropdown
- External editor dropdown only shows editors where `type === "external"` + "System Default"

### Tab Behavior

- CLI editor tabs use type `"shell"` — they render as standard terminal tabs
- Label format: `"<editor>: <basename>"` (e.g., `"nvim: config.ts"`)
- Tab stays open after the editor exits
- The terminal is fully interactive — user can restart the editor, run commands, etc.

## Out of Scope

- Per-file-type editor mapping
- "Open with..." context menu
- Editor plugin/extension management
- Embedded terminal multiplexing
