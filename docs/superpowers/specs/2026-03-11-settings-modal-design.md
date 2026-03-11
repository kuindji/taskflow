# Settings Modal Design

## Overview

A modal dialog for configuring font settings (family and size) for both the application UI and terminal. Works in both Electron and browser contexts. Changes apply immediately without restart.

## Trigger

Wire the existing `Settings` stub button in `TaskSidebar.tsx` (around line 167-169) to toggle a `settingsOpen` flag in `useUIStore`. No new button needed.

## Rendering Location

The modal renders at the top level in `App.tsx` (alongside `DialogHost` and `ConnectionOverlay`), not inside the sidebar. This avoids clipping from the sidebar's `overflow-hidden` container. Uses the existing Radix `Dialog` wrapper from `packages/ui/src/components/ui/dialog.tsx` which provides:
- Portal rendering
- Escape key to close
- Focus trap
- ARIA `role="dialog"`, `aria-modal`, `aria-labelledby`
- Focus return to trigger on close
- Backdrop click to close

## Font Enumeration

- Call `queryLocalFonts()` when the modal opens
- Deduplicate results by font family name
- Sort alphabetically
- Present as a searchable dropdown (type-to-filter)
- If `queryLocalFonts()` is unavailable or user denies permission, show a text input fallback

## Modal Layout

Two sections stacked vertically:

### Application Font
- **Font Family** - searchable dropdown populated from `queryLocalFonts()`
- **Font Size** - number input (stepper arrows)

### Terminal Font
- **Font Family** - searchable dropdown populated from `queryLocalFonts()`
- **Font Size** - number input (stepper arrows)

No save/cancel buttons. All changes apply and persist immediately.

## State Management

- `useUIStore` gets a `settingsOpen` boolean and `toggleSettings()` action
- `TaskSidebar` calls `toggleSettings()` on the existing Settings button click
- `App.tsx` reads `settingsOpen` and renders `SettingsModal` conditionally

## Live Apply

- **General (app) fonts:** Already reactive. `App.tsx` applies `fontFamily` and `fontSize` via inline style on the root element, driven by `useSettingsStore`.
- **Terminal fonts:** Update existing cached xterm instances by setting `term.options.fontFamily` and `term.options.fontSize`, then calling `fitAddon.fit()`. Subscribe to settings store changes in terminal pane via `useEffect`.

## Persistence

Each change dispatches `SETTINGS_UPDATE` via the existing WebSocket message flow (`MSG.SETTINGS_UPDATE`). The backend `SettingsStore` writes to `~/.config/taskflow/settings.json`.

## Components

| Component | Location | Purpose |
|-----------|----------|---------|
| `SettingsModal` | `packages/ui/src/components/settings/SettingsModal.tsx` | Radix Dialog-based modal with font setting sections |
| `FontFamilySelect` | `packages/ui/src/components/settings/FontFamilySelect.tsx` | Searchable dropdown using `queryLocalFonts()` |

## Existing Infrastructure Used

- **Types:** `AppSettings`, `GeneralSettings`, `TerminalSettings` in `packages/shared/src/types/settings.ts`
- **Frontend store:** `useSettingsStore` in `packages/ui/src/stores/settings-store.ts`
- **Backend store:** `SettingsStore` in `packages/backend/src/services/settings-store.ts`
- **WebSocket messages:** `MSG.SETTINGS_GET`, `MSG.SETTINGS_UPDATE` in `packages/shared/src/constants.ts`
- **Handler:** `packages/backend/src/handlers/settings.ts`
- **Dialog primitive:** `packages/ui/src/components/ui/dialog.tsx` (Radix wrapper)

## Terminal Live Update Strategy

The terminal pane currently applies font settings only at creation time. To support live updates:

1. In `TerminalPane.tsx`, add a `useEffect` that subscribes to `useSettingsStore` terminal settings
2. When terminal settings change, update `term.options.fontFamily` and `term.options.fontSize` on the cached xterm instance
3. Only call `fitAddon.fit()` if the terminal element is currently attached to the DOM (visible tab). For hidden/detached terminals, the next `fit()` call when the tab becomes visible will pick up the new font settings automatically.
