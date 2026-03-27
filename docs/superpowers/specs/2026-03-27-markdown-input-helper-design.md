# Markdown Input Helper — Design Spec

## Overview

A floating Monaco markdown editor overlay for agent sessions, providing a comfortable way to compose long prompts. Appears as a draggable, resizable floating window inside the terminal pane.

## Problem

Agent CLIs capture their own input via terminal. Writing long, structured prompts in a raw terminal line is painful — no word wrap, no syntax highlighting, no multi-line editing comfort. This feature adds a toggleable markdown editor that writes composed text directly to the agent session.

## UX Model

The editor has its own independent buffer per session. No sync with terminal input — it's a one-way compose-and-send tool.

### Actions

| Action | Trigger | Behavior |
|--------|---------|----------|
| Open | Click trigger button or ⌘⇧I | Show editor at saved position (or bottom-center default). Clamp to container bounds. |
| Send | Click Send or ⌘↵ | Write content to session + `\r` + clear buffer |
| Insert | Split dropdown → Insert | Write content to session + clear buffer (no `\r`) |
| Close | Click × or ⌘⇧I | Hide editor, keep buffer |
| Move | Drag top strip | Update position, persist |
| Resize | Drag corner handle | Update size, persist |

### Buffer Lifecycle

- Unique per session ID
- Persists across open/close within the same session
- Cleared on Send or Insert
- Lost when session closes

## Visual Design

- **Style**: Minimal dark, rounded (12px border-radius), matches terminal aesthetic
- **No header bar**: Close button (×) is absolute-positioned top-right
- **Drag zone**: Invisible strip across the top ~24px (left of close button)
- **Editor area**: Monaco with markdown language, starts immediately at top of panel
- **Footer**: Same background as editor (no visual separation). Shortcut hint (⌘⇧I) bottom-left, split Send button bottom-right
- **Send button**: Split — primary "Send ↵" with dropdown chevron for "Insert"
- **Default position**: Bottom-center of terminal pane container
- **Trigger button**: Small rounded square (pen icon, purple accent) in bottom-right corner of terminal pane. Only visible on agent sessions.

## Component Architecture

### MarkdownInputHelper (React component)

Rendered inside `TerminalPane` container (which is `position: relative`). Uses `position: absolute` to float over the terminal.

**Renders:**
- Trigger button (when editor is closed)
- Floating editor panel (when open)

### markdown-input-store (Zustand store)

State keyed by session ID:

```
{
  [sessionId]: {
    buffer: string
    isOpen: boolean
    position: { x: number, y: number }
    size: { width: number, height: number }
  }
}
```

**Actions:**
- `open(sessionId)` — set isOpen true, clamp position to current container bounds
- `close(sessionId)` — set isOpen false, keep buffer
- `toggle(sessionId)` — toggle isOpen
- `setBuffer(sessionId, text)` — update buffer from Monaco onChange
- `clearBuffer(sessionId)` — reset buffer to empty string
- `setPosition(sessionId, {x, y})` — update after drag
- `setSize(sessionId, {width, height})` — update after resize
- `cleanup(sessionId)` — remove state for closed session

### Visibility Logic

Trigger button and ⌘⇧I shortcut only active for agent session types: `claude`, `codex`, `gemini`, `opencode`, `cursor`. Determined by checking the tab's `type` field from session store.

### Monaco Configuration

- Language: markdown
- Theme: synced with app theme (MONACO_THEME_NAME)
- Font: from settings (editor font family/size)
- Word wrap: on
- Minimap: off
- Line numbers: off
- Folding: off
- automaticLayout: true
- Padding: top 10px, bottom 10px

Instance created on first open, reused across open/close cycles. Disposed on component unmount.

### Writing to Session

Uses existing `sendInput(sessionId, data)` from session store, which sends fire-and-forget WebSocket message. For Send: `sendInput(sessionId, text + "\r")`. For Insert: `sendInput(sessionId, text)`.

### Keyboard Shortcut

⌘⇧I (Cmd+Shift+I) registered in the terminal pane's custom key event handler. The existing handler already lets Meta combos bubble — this one needs to be intercepted before bubbling and routed to `toggle(sessionId)`.

### Position/Size Persistence

- Saved in the Zustand store per session (in-memory only, not persisted to disk)
- Default size: 480×200 (or percentage-based if container is small)
- Default position: bottom-center of container
- On open: clamp saved position/size to current container bounds (handles window resize while editor was closed)

### Drag Implementation

Pointer events on the top strip element:
- `onPointerDown` → start tracking, set `pointer-events: none` on iframe/editor to prevent stealing events
- `onPointerMove` → update position, clamp to container bounds
- `onPointerUp` → stop tracking, persist position

### Resize Implementation

Pointer events on a corner resize handle (bottom-right):
- Same pointer capture pattern as drag
- Enforce minimum size (300×150)
- Clamp to container bounds

## File Structure

```
packages/ui/src/
  components/panes/terminal/
    MarkdownInputHelper.tsx    — main component (trigger button + floating editor)
    markdown-input-helper.css  — styles (or Tailwind classes)
  stores/
    markdown-input-store.ts    — Zustand store for editor state
```

## Out of Scope

- Two-way sync with terminal input
- Keystroke buffer tracking from terminal
- Persisting buffer to disk
- Multiple editors per session
- Non-agent session types
