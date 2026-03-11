# Settings Modal Design

## Overview

A modal dialog for configuring font settings (family and size) for both the application UI and terminal. Works in both Electron and browser contexts. Changes apply immediately without restart.

## Trigger

A gear icon button in the sidebar area. Clicking opens the settings modal as an overlay.

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

## Live Apply

- **General (app) fonts:** Already reactive. `App.tsx` applies `fontFamily` and `fontSize` via inline style on the root element, driven by `useSettingsStore`.
- **Terminal fonts:** Update existing cached xterm instances by setting `term.options.fontFamily` and `term.options.fontSize`, then calling `fitAddon.fit()`. Subscribe to settings store changes in terminal pane or via a shared effect.

## Persistence

Each change dispatches `SETTINGS_UPDATE` via the existing WebSocket message flow. The backend `SettingsStore` writes to `~/.config/taskflow/settings.json`.

## Components

| Component | Location | Purpose |
|-----------|----------|---------|
| `SettingsModal` | `packages/ui/src/components/settings/SettingsModal.tsx` | Modal container with backdrop, sections |
| `FontFamilySelect` | `packages/ui/src/components/settings/FontFamilySelect.tsx` | Searchable dropdown using `queryLocalFonts()` |
| Settings trigger button | Added to sidebar or app shell | Opens the modal |

## Existing Infrastructure Used

- **Types:** `AppSettings`, `GeneralSettings`, `TerminalSettings` in `packages/shared/src/types/settings.ts`
- **Frontend store:** `useSettingsStore` in `packages/ui/src/stores/settings-store.ts`
- **Backend store:** `SettingsStore` in `packages/backend/src/services/settings-store.ts`
- **WebSocket messages:** `SETTINGS_GET`, `SETTINGS_UPDATE` in `packages/shared/src/constants.ts`
- **Handler:** `packages/backend/src/handlers/settings.ts`

## Terminal Live Update Strategy

The terminal pane currently applies font settings only at creation time. To support live updates:

1. In `TerminalPane.tsx`, add a `useEffect` that subscribes to `useSettingsStore` terminal settings
2. When terminal settings change, update `term.options.fontFamily` and `term.options.fontSize` on the cached xterm instance
3. Call `fitAddon.fit()` to reflow the terminal layout
