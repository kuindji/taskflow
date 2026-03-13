# Full Theming Support with Existing Themes

## Overview

Add a theming system to Taskflow that uses terminal color themes as the source of truth for the entire application — UI chrome, xterm.js terminals, and Monaco editor. Users can choose from bundled themes, import from their installed terminal apps, drop custom theme files in a config directory, or browse themes from terminalcolors.com.

## Theme Data Model

Each theme, regardless of source, is represented as a `ThemeSource`:

```typescript
interface ThemeSource {
  version: 1;
  name: string;
  author?: string;
  origin: "bundled" | "imported" | "custom" | "online";

  colors: {
    foreground: string;
    background: string;
    cursor: string;
    cursorText: string;
    selection: string;
    selectionText: string;
    ansi: {
      black: string;
      red: string;
      green: string;
      yellow: string;
      blue: string;
      magenta: string;
      cyan: string;
      white: string;
      brightBlack: string;
      brightRed: string;
      brightGreen: string;
      brightYellow: string;
      brightBlue: string;
      brightMagenta: string;
      brightCyan: string;
      brightWhite: string;
    };
  };

  overrides?: Partial<Record<string, string>>;
}
```

The `overrides` field allows any theme to hand-tune derived CSS variable values where auto-derivation produces poor results.

The `version` field enables future format evolution. The theme loader validates the version field and skips files with unknown versions, logging a warning.

## Theme Sources & Storage

### Bundled Themes

JSON files shipped in `packages/shared/src/themes/bundled/`. Always available. Starting set (~6-8):

- Catppuccin Mocha (current default)
- Dracula
- Nord
- Gruvbox Dark
- Tokyo Night
- Solarized Dark
- One Dark (optional)
- Rosé Pine (optional)

### Custom User Themes

Users place `.json` files in `~/.config/taskflow/themes/`. Same `ThemeSource` format. Backend scans this directory on startup and when the Appearance dialog opens.

### Imported from Terminal Apps

The Appearance dialog detects installed terminal apps on macOS and parses their theme configs. Imported themes are saved to `~/.config/taskflow/themes/` as JSON, becoming custom themes from that point.

Supported apps:
- **iTerm2** — binary/XML plist at `~/Library/Preferences/com.googlecode.iterm2.plist`, float RGB components → hex
- **Alacritty** — TOML at `~/.config/alacritty/alacritty.toml`, clean `[colors.primary]`/`[colors.normal]`/`[colors.bright]` structure
- **Warp** — YAML files in `~/.warp/themes/`
- **Ghostty** — plain text at `~/.config/ghostty/config`, key-value pairs
- **Kitty** — plain text at `~/.config/kitty/kitty.conf`, `color0`-`color15` keys
- **Terminal.app** — XML plist with NSKeyedArchiver color blobs, best-effort support

Each parser is a standalone function. Detection checks if the config file exists. Parsing failures are skipped gracefully with a warning.

### Online (terminalcolors.com)

A dedicated dialog fetches the theme list, shows previews, and downloads the Alacritty TOML for the selected theme. Parsed and saved to `~/.config/taskflow/themes/`.

All network requests to terminalcolors.com go through the **backend** (not the renderer) to avoid CORS restrictions. The UI sends a WebSocket message (`THEME_DOWNLOAD`), the backend fetches the TOML, parses it, saves the resulting JSON, and returns the theme to the UI.

### Settings Persistence

`~/.config/taskflow/settings.json` stores only the active theme name in `appearance.theme`. Theme files live separately.

## Derivation Engine

A pure function that takes a `ThemeSource` and produces three outputs:

### CSS Variables

All variables currently in `:root` in `global.css` must be produced by the derivation engine:

| CSS Variable | Source | Rule |
|---|---|---|
| `--background` | `background` | direct |
| `--foreground` | `foreground` | direct |
| `--card` | `ansi.black` | direct |
| `--card-foreground` | `foreground` | direct |
| `--popover` | `selection` | direct |
| `--popover-foreground` | `foreground` | direct |
| `--primary` | `foreground` | direct |
| `--primary-foreground` | `background` | inverted |
| `--secondary` | `selection` | direct |
| `--secondary-foreground` | `foreground` | direct |
| `--accent` | `ansi.blue` | direct |
| `--accent-foreground` | `background` | direct |
| `--muted` | `selection` | direct |
| `--muted-foreground` | `ansi.brightBlack` | direct |
| `--destructive` | `ansi.red` | direct |
| `--destructive-foreground` | `background` | direct |
| `--success` | `ansi.green` | direct |
| `--success-foreground` | `background` | direct |
| `--warning` | `ansi.yellow` | direct |
| `--warning-foreground` | `background` | direct |
| `--info` | `ansi.cyan` | direct |
| `--info-foreground` | `background` | direct |
| `--border` | `selection` | lighten ~10% |
| `--input` | `selection` | direct |
| `--ring` | `ansi.blue` | direct |
| `--island-base` | `background` | 50% opacity |
| `--chart-1` | `ansi.blue` | direct |
| `--chart-2` | `ansi.green` | direct |
| `--chart-3` | `ansi.magenta` | direct |
| `--chart-4` | `ansi.cyan` | direct |
| `--chart-5` | `ansi.yellow` | direct |
| `--sidebar-*` | mirrors main tokens | direct |

Overrides are applied as a final spread: `{ ...derived, ...theme.overrides }`.

### xterm.js Theme

Direct passthrough of all 20 terminal colors into the xterm.js `ITheme` object, plus `cursorAccent` mapped to `colors.background`. The `getTerminalTheme()` function in TerminalPane must be **rewritten** to accept the resolved theme object directly rather than reading CSS vars. The current implementation reads a mix of CSS vars and hardcoded Catppuccin hex values — all hardcoded values must be removed. The `useTheme` hook provides the resolved xterm theme object via a store or context.

### Monaco Editor Theme

Registered at module load time (top-level in a `monaco-setup.ts` file or similar, not inside a hook or effect) with Catppuccin Mocha defaults via `monaco.editor.defineTheme("taskflow", { ... })`. This ensures the theme exists before any `EditorPane` mounts. The theme name `"taskflow"` is used in all `monaco.editor.create()` calls instead of `"vs-dark"`. When the active theme changes, `useTheme` calls `monaco.editor.defineTheme("taskflow", { ... })` with the new colors followed by `monaco.editor.setTheme("taskflow")` — this is a global call that updates all existing editor instances.

Maps:
- Editor background/foreground from theme background/foreground
- Syntax tokens from ANSI colors (strings→green, keywords→blue, errors→red, comments→brightBlack, etc.)

### Utilities

Small color utilities, no external dependencies:
- `lighten(hex, amount)` — for `--border` derivation (lighten selection ~10%)
- `hexToRgba(hex, alpha)` — for `--island-base` derivation (background at 50% opacity, output as `rgba()` string)

## Appearance Dialog

A new dialog, separate from Settings. Opened via a palette/paintbrush icon button in the TaskSidebar footer, next to the existing Settings button.

### Layout: Three Tabs

**"Themes" (default):**
- Grid of theme cards with color palette preview + name + origin badge (bundled/custom/imported)
- Click to apply immediately (live preview, no confirm step)
- Active theme highlighted with checkmark
- Search/filter bar if list grows

**"Import":**
- Auto-detects installed terminal apps, lists them with icons
- Each app shows discovered themes/profiles
- Click to import → parsed → saved to `~/.config/taskflow/themes/` → appears in Themes grid
- "From File..." option for manual file selection

**"Browse Online":**
- Fetches theme list from terminalcolors.com
- Grid of theme cards with preview swatches
- Click to download + install → saved to `~/.config/taskflow/themes/`

### Theme Application

Click-to-apply with no revert. Clicking a theme immediately:
1. Applies CSS variables to `document.documentElement.style`
2. Re-themes all open xterm.js instances
3. Re-themes Monaco editor
4. Persists theme name to settings

## Integration Points

### Settings Type (`packages/shared/src/types/settings.ts`)
- Add `appearance: { theme: string }` to `AppSettings`
- Add `appearance?: { theme?: string }` to `SettingsUpdatePayload`
- Update `SettingsStore.update()` merge logic to handle the new `appearance` field

### Backend (`packages/backend`)
- `config.ts` — add `themesDir: join(CONFIG_DIR, "themes")` and add it to `ensureDirectories()`
- New `ThemeService` — loads bundled themes, scans user themes dir, handles parsing
- New WebSocket messages added to `MSG` constants in `packages/shared/src/constants.ts`: `THEMES_LIST`, `THEME_IMPORT`, `THEME_DOWNLOAD`
- Corresponding payload/response types added to `packages/shared/src/types/ws.ts`
- Active theme name persisted via existing `SETTINGS_UPDATE` flow

### App Root (`packages/ui/src/App.tsx`)
- Add `useTheme` hook that watches active theme, runs derivation, applies CSS vars to `document.documentElement.style`

### Global CSS (`packages/ui/src/styles/global.css`)
- Keep hardcoded `:root` color values as the **default fallback theme** (Catppuccin Mocha). This ensures the app renders correctly during startup before settings load and `useTheme` applies the active theme. The JS theme application overwrites these values on `document.documentElement.style`, which takes precedence over the stylesheet `:root` block.
- Keep `@theme inline` Tailwind mappings (reference CSS vars which still exist)
- Keep radius, font-stack, and non-color tokens static

### TerminalPane
- Rewrite `getTerminalTheme()` to accept the resolved xterm theme from the theme store rather than reading CSS vars
- Remove all hardcoded Catppuccin hex values (magenta, cyan, white, cursor, etc.)
- On theme change, update all existing terminal instances: `term.options.theme = newTheme`

### EditorPane
- Replace hardcoded `"vs-dark"` with dynamically registered theme
- Re-apply on theme change

### TaskSidebar Footer
- Add Appearance button (`Palette` icon from Lucide) next to Settings button
