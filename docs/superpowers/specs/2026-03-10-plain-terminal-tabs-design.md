# Plain Terminal Tabs

## Overview

Add plain terminal tabs (bash, zsh, fish, etc.) to task workspaces, alongside existing claude/codex agent tabs. Shells are detected from `/etc/shells` and presented as individual options in the tab bar's "+" dropdown.

## Shell Detection

- On backend startup (or on first request), parse `/etc/shells` to extract available shell paths
- Filter to recognized interactive shells (bash, zsh, fish, sh, etc.), deduplicate by base name
- Expose detected shells to the UI via a new `shells:list` WebSocket request
- Response: array of `{ name: string; path: string }` (e.g. `{ name: "zsh", path: "/bin/zsh" }`)

## Type Changes

- `SessionRef.type`: add `'shell'` to the union (`'claude' | 'codex' | 'shell'`)
- `Tab.type`: add `'shell'` to the union
- `SessionCreatePayload`: add optional `shell` field (full path, e.g. `/bin/zsh`) used when `type === 'shell'`
- New message type `SHELLS_LIST` in constants
- New response type for shells list

## Backend Changes

### Session Handler

When `type === 'shell'`:
- Use `payload.shell` as the command (e.g. `/bin/zsh`) instead of `claude`/`codex`
- No args (no prompt)
- No need to strip `CLAUDECODE`/`CLAUDE_CODE_ENTRYPOINT` env vars (only needed for agent sessions), though stripping them is harmless
- Working directory: same logic as agents — task worktree path or project path

### Shells List Handler

- New handler for `shells:list` request
- Reads and parses `/etc/shells`
- Returns array of `{ name, path }` objects
- Filters out comments, empty lines, and non-existent paths

### PtyManager

No changes needed — already generic, accepts any command.

## UI Changes

### TabBar

- Fetch available shells on mount (via `shells:list` WebSocket request)
- Add one entry per detected shell in the "+" dropdown (e.g. "Zsh", "Bash", "Fish")
- Each entry uses Terminal icon and `text-info` color
- Clicking a shell entry calls `handleNewTab` with type `'shell'` and the shell path

### Session Store

- `Tab.type` union extended with `'shell'`
- `createSession` accepts `'shell'` type and passes shell path in payload

### TabContent

- `'shell'` case renders `TerminalPane` (same component as claude/codex)
- Uses always-mounted strategy (hidden/visible) to preserve terminal buffer

### Workspace

- `handleNewTab` extended to handle shell type, passing shell path to `createSession`

## Tab Styling

- Label: shell name, e.g. "zsh", "bash", "fish"
- Color: `text-info` (blue tone) to distinguish from agent sessions
- Icon: Terminal icon

## Files to Modify

- `packages/shared/src/types/task.ts` — SessionRef type
- `packages/shared/src/types/ws.ts` — SessionCreatePayload, ShellInfo type
- `packages/shared/src/constants.ts` — SHELLS_LIST message type
- `packages/backend/src/handlers/session.ts` — shell spawning logic
- `packages/backend/src/index.ts` — register shells:list handler
- `packages/ui/src/stores/session-store.ts` — Tab type, createSession
- `packages/ui/src/components/workspace/TabBar.tsx` — shell entries in dropdown
- `packages/ui/src/components/workspace/TabContent.tsx` — shell case
- `packages/ui/src/components/workspace/Workspace.tsx` — handleNewTab for shell
