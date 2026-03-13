# Full Theming Support Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a theming system that uses terminal color themes as the source of truth for the entire app (UI, xterm.js, Monaco), with bundled themes, terminal app import, custom user themes, and online browsing.

**Architecture:** Terminal themes (20 colors) are mapped through a derivation engine to produce CSS variables, xterm.js theme, and Monaco theme. Raw theme files stay in the `ThemeSource` format, while the backend exposes `ThemeRecord { id, source }` objects so the UI and settings can use a stable canonical theme id. `ThemeService` reserves bundled ids, generates collision-free ids for imported/custom themes, and only reuses an explicit id when intentionally updating an existing non-bundled theme. A `ThemeService` on the backend handles loading/parsing/scanning. The UI has a dedicated Appearance dialog with three tabs (Themes, Import, Browse Online). Theme state flows through a Zustand store with a `useTheme` hook applying colors at runtime.

**Tech Stack:** TypeScript, React, Zustand, Tailwind CSS v4, xterm.js, Monaco Editor, Bun test runner

**Spec:** `docs/superpowers/specs/2026-03-13-full-theming-support-design.md`

---

## Chunks

| Chunk | File | Description |
|-------|------|-------------|
| 1 | `full-theming-support-chunk-1.md` | Foundation — Types, Constants, Color Utilities, Derivation Engine |
| 2 | `full-theming-support-chunk-2.md` | Backend — Config, Settings Store, Theme Service, Handlers |
| 3 | `full-theming-support-chunk-3.md` | UI Integration — Theme Store, useTheme Hook, Monaco Setup, Terminal/Editor Updates |
| 4 | `full-theming-support-chunk-4.md` | Appearance Dialog & Sidebar Button |
| 5 | `full-theming-support-chunk-5.md` | Terminal App Parsers |
| 6 | `full-theming-support-chunk-6.md` | Online Theme Browsing |

---

## File Structure

### New Files

**Shared (types & bundled themes):**
- `packages/shared/src/types/theme.ts` — `ThemeSource`, `ThemeRecord`, `ThemeColors`, `AnsiColors`, `ResolvedTheme`, `CssVariables` types
- `packages/shared/src/themes/bundled/catppuccin-mocha.json` — bundled theme
- `packages/shared/src/themes/bundled/dracula.json` — bundled theme
- `packages/shared/src/themes/bundled/nord.json` — bundled theme
- `packages/shared/src/themes/bundled/gruvbox-dark.json` — bundled theme
- `packages/shared/src/themes/bundled/tokyo-night.json` — bundled theme
- `packages/shared/src/themes/bundled/solarized-dark.json` — bundled theme
- `packages/shared/src/themes/index.ts` — exports bundled themes array
- `packages/shared/src/themes/color-utils.ts` — `lighten()`, `hexToRgba()` utilities
- `packages/shared/src/themes/derive.ts` — derivation engine: `ThemeSource` → `ResolvedTheme`

**Backend (service & parsers):**
- `packages/backend/src/services/theme-service.ts` — loads bundled + user themes, scan/save/delete
- `packages/backend/src/services/theme-parsers/index.ts` — re-exports all parsers
- `packages/backend/src/services/theme-parsers/alacritty.ts` — TOML parser
- `packages/backend/src/services/theme-parsers/iterm2.ts` — plist parser
- `packages/backend/src/services/theme-parsers/warp.ts` — YAML parser
- `packages/backend/src/services/theme-parsers/ghostty.ts` — plain text parser
- `packages/backend/src/services/theme-parsers/kitty.ts` — plain text parser
- `packages/backend/src/services/theme-parsers/terminal-app.ts` — plist + NSKeyedArchiver (best-effort)
- `packages/backend/src/handlers/theme.ts` — WebSocket handlers for theme messages

**UI (store, hook, dialog):**
- `packages/ui/src/stores/theme-store.ts` — Zustand store for theme list + active theme
- `packages/ui/src/hooks/useTheme.ts` — applies resolved theme to DOM, xterm, Monaco
- `packages/ui/src/lib/monaco-theme.ts` — module-level Monaco theme registration + update function
- `packages/ui/src/components/appearance/AppearanceDialog.tsx` — main dialog shell with tabs
- `packages/ui/src/components/appearance/ThemeGrid.tsx` — grid of theme cards
- `packages/ui/src/components/appearance/ThemeCard.tsx` — single theme preview card
- `packages/ui/src/components/appearance/ImportTab.tsx` — detect & import from terminal apps
- `packages/ui/src/components/appearance/BrowseOnlineTab.tsx` — browse terminalcolors.com

**Tests:**
- `packages/backend/tests/services/theme-service.test.ts`
- `packages/shared/tests/themes/color-utils.test.ts`
- `packages/shared/tests/themes/derive.test.ts`
- `packages/backend/tests/services/theme-parsers/alacritty.test.ts`
- `packages/backend/tests/services/theme-parsers/ghostty.test.ts`
- `packages/backend/tests/services/theme-parsers/kitty.test.ts`
- `packages/backend/tests/services/theme-parsers/warp.test.ts`
- `packages/backend/tests/services/theme-parsers/iterm2.test.ts`
- `packages/backend/tests/services/theme-parsers/terminal-app.test.ts`

### Modified Files

- `packages/shared/src/types/settings.ts` — add appearance section to `AppSettings` and `SettingsUpdatePayload` (no separate named interface needed — inline `{ theme: string }` matches the pattern of other settings sections)
- `packages/shared/src/constants.ts` — add `THEMES_LIST`, `THEME_IMPORT_SCAN`, `THEME_IMPORT`, `THEME_IMPORT_FILE`, `THEME_BROWSE_LIST`, `THEME_DOWNLOAD`, `THEME_DELETE` to `MSG`; add `DEFAULT_THEME_ID`
- `packages/shared/src/types/ws.ts` — add theme WebSocket payload/response types
- `packages/shared/src/index.ts` — add theme exports
- `packages/backend/src/config.ts` — add `themesDir`, update `ensureDirectories()`
- `packages/backend/src/services/settings-store.ts` — add `appearance` to defaults, `get()`, and `update()`
- `packages/backend/src/index.ts` — register theme handlers
- `packages/backend/tests/services/settings-store.test.ts` — update tests for appearance field
- `electron/src/preload.ts` — expose `selectThemeFile()` bridge method
- `electron/src/main.ts` — implement `select-theme-file` IPC handler
- `packages/ui/src/components/sidebar/TaskSidebar.tsx` — add Appearance button, add `fetchThemes` to startup effect
- `packages/ui/src/components/panes/TerminalPane.tsx` — rewrite `getTerminalTheme()`, add re-theme on change
- `packages/ui/src/components/panes/EditorPane.tsx` — use `"taskflow"` theme instead of `"vs-dark"`
- `packages/ui/src/App.tsx` — add `AppearanceDialog`, import `useTheme` hook, import monaco-theme setup
- `packages/ui/src/stores/ui-store.ts` — add `appearanceOpen`, `setAppearanceOpen()`, and `toggleAppearance()`
- `packages/ui/src/env.d.ts` — type `selectThemeFile()` on the renderer bridge
