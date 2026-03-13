# Full Theming Support with Existing Themes

## Overview

Add a theming system to Taskflow that uses terminal color themes as the source of truth for the entire application — UI chrome, xterm.js terminals, and Monaco editor. Users can choose from bundled themes, import from their installed terminal apps, drop custom theme files in a config directory, or browse themes from terminalcolors.com.

## Theme Data Model

Each theme, regardless of source, is represented as a `ThemeSource`:

```typescript
interface ThemeSource {
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

### Settings Persistence

`~/.config/taskflow/settings.json` stores only the active theme name in `appearance.theme`. Theme files live separately.

## Derivation Engine

A pure function that takes a `ThemeSource` and produces three outputs:

### CSS Variables (~31 tokens)

| CSS Variable | Source | Rule |
|---|---|---|
| `--background` | `background` | direct |
| `--foreground` | `foreground` | direct |
| `--card` | `ansi.black` | direct |
| `--card-foreground` | `foreground` | direct |
| `--primary` | `foreground` | direct |
| `--primary-foreground` | `background` | inverted |
| `--secondary` | `selection` | direct |
| `--secondary-foreground` | `foreground` | direct |
| `--accent` | `ansi.blue` | direct |
| `--accent-foreground` | `background` | direct |
| `--muted` | `selection` | direct |
| `--muted-foreground` | `ansi.brightBlack` | direct |
| `--destructive` | `ansi.red` | direct |
| `--destructive-foreground` | `foreground` | direct |
| `--success` | `ansi.green` | direct |
| `--warning` | `ansi.yellow` | direct |
| `--info` | `ansi.cyan` | direct |
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

Direct passthrough of all 20 terminal colors. No derivation — terminal themes are the source of truth.

### Monaco Editor Theme

Programmatically registered via `monaco.editor.defineTheme()`. Maps:
- Editor background/foreground from theme background/foreground
- Syntax tokens from ANSI colors (strings→green, keywords→blue, errors→red, comments→brightBlack, etc.)

### Utilities

One small utility: `lighten(hex, amount)` for `--border` derivation. No external dependencies.

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

### Backend (`packages/backend`)
- `config.ts` — add `themesDir: join(CONFIG_DIR, "themes")`
- New `ThemeService` — loads bundled themes, scans user themes dir, handles parsing
- New WebSocket messages: `THEMES_LIST`, `THEME_IMPORT`, `THEME_DOWNLOAD`
- Active theme name persisted via existing `SETTINGS_UPDATE` flow

### App Root (`packages/ui/src/App.tsx`)
- Add `useTheme` hook that watches active theme, runs derivation, applies CSS vars to `document.documentElement.style`

### Global CSS (`packages/ui/src/styles/global.css`)
- Remove hardcoded `:root` color values (set dynamically by JS)
- Keep `@theme inline` Tailwind mappings (reference CSS vars which still exist)
- Keep radius, font-stack, and non-color tokens static

### TerminalPane
- `getTerminalTheme()` already reads CSS vars — mostly works after vars update
- Add re-theme on change: `term.options.theme = getTerminalTheme()`
- Remove hardcoded magenta/cyan/white values that bypass CSS vars

### EditorPane
- Replace hardcoded `"vs-dark"` with dynamically registered theme
- Re-apply on theme change

### TaskSidebar Footer
- Add Appearance button (`Palette` icon from Lucide) next to Settings button
