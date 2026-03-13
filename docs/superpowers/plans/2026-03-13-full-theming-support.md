# Full Theming Support Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a theming system that uses terminal color themes as the source of truth for the entire app (UI, xterm.js, Monaco), with bundled themes, terminal app import, custom user themes, and online browsing.

**Architecture:** Terminal themes (20 colors) are mapped through a derivation engine to produce CSS variables, xterm.js theme, and Monaco theme. Raw theme files stay in the `ThemeSource` format, while the backend exposes `ThemeRecord { id, source }` objects so the UI and settings can use a stable canonical theme id. A `ThemeService` on the backend handles loading/parsing/scanning. The UI has a dedicated Appearance dialog with three tabs (Themes, Import, Browse Online). Theme state flows through a Zustand store with a `useTheme` hook applying colors at runtime.

**Tech Stack:** TypeScript, React, Zustand, Tailwind CSS v4, xterm.js, Monaco Editor, Bun test runner

**Spec:** `docs/superpowers/specs/2026-03-13-full-theming-support-design.md`

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

### Modified Files

- `packages/shared/src/types/settings.ts` — add `AppearanceSettings`, update `AppSettings` and `SettingsUpdatePayload`
- `packages/shared/src/constants.ts` — add `THEMES_LIST`, `THEME_IMPORT_SCAN`, `THEME_IMPORT`, `THEME_BROWSE_LIST`, `THEME_DOWNLOAD`, `THEME_DELETE` to `MSG`; add `DEFAULT_THEME_ID`
- `packages/shared/src/types/ws.ts` — add theme WebSocket payload/response types
- `packages/shared/src/index.ts` — add theme exports
- `packages/backend/src/config.ts` — add `themesDir`, update `ensureDirectories()`
- `packages/backend/src/services/settings-store.ts` — add `appearance` to defaults, `get()`, and `update()`
- `packages/backend/src/index.ts` — register theme handlers
- `packages/backend/tests/services/settings-store.test.ts` — update tests for appearance field
- `packages/ui/src/components/sidebar/TaskSidebar.tsx` — add Appearance button, add `fetchThemes` to startup effect
- `packages/ui/src/components/panes/TerminalPane.tsx` — rewrite `getTerminalTheme()`, add re-theme on change
- `packages/ui/src/components/panes/EditorPane.tsx` — use `"taskflow"` theme instead of `"vs-dark"`
- `packages/ui/src/App.tsx` — add `AppearanceDialog`, import `useTheme` hook, import monaco-theme setup
- `packages/ui/src/stores/ui-store.ts` — add `appearanceOpen`, `setAppearanceOpen()`, and `toggleAppearance()`

---

## Chunk 1: Foundation — Types, Constants, Color Utilities, Derivation Engine

### Task 1: Theme Types

**Files:**
- Create: `packages/shared/src/types/theme.ts`
- Modify: `packages/shared/src/index.ts`

- [ ] **Step 1: Create theme type definitions**

```typescript
// packages/shared/src/types/theme.ts

interface AnsiColors {
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
}

interface ThemeColors {
    foreground: string;
    background: string;
    cursor: string;
    cursorText: string;
    selection: string;
    selectionText: string;
    ansi: AnsiColors;
}

type ThemeOrigin = "bundled" | "imported" | "custom" | "online";

interface ThemeSource {
    version: 1;
    name: string;
    author?: string;
    origin: ThemeOrigin;
    colors: ThemeColors;
    overrides?: Partial<CssVariables>;
}

interface ThemeRecord {
    id: string;
    source: ThemeSource;
}

interface CssVariables {
    "--background": string;
    "--foreground": string;
    "--card": string;
    "--card-foreground": string;
    "--popover": string;
    "--popover-foreground": string;
    "--primary": string;
    "--primary-foreground": string;
    "--secondary": string;
    "--secondary-foreground": string;
    "--accent": string;
    "--accent-foreground": string;
    "--muted": string;
    "--muted-foreground": string;
    "--destructive": string;
    "--destructive-foreground": string;
    "--success": string;
    "--success-foreground": string;
    "--warning": string;
    "--warning-foreground": string;
    "--info": string;
    "--info-foreground": string;
    "--border": string;
    "--input": string;
    "--ring": string;
    "--island-base": string;
    "--chart-1": string;
    "--chart-2": string;
    "--chart-3": string;
    "--chart-4": string;
    "--chart-5": string;
    [key: `--sidebar-${string}`]: string;
}

interface XtermTheme {
    background: string;
    foreground: string;
    cursor: string;
    cursorAccent: string;
    selectionBackground: string;
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
}

interface ResolvedTheme {
    source: ThemeSource;
    css: CssVariables;
    xterm: XtermTheme;
    // Monaco theme rules are built in UI-only code (monaco-theme.ts)
}
```

Note: export only types/interfaces that are used outside the file. `ThemeSource`, `ThemeRecord`, `ThemeColors`, `AnsiColors`, `ThemeOrigin`, `ResolvedTheme`, `CssVariables`, `XtermTheme` will all be needed externally.

- [ ] **Step 2: Add theme type exports to shared index**

Add to `packages/shared/src/index.ts`:
```typescript
export * from "./types/theme";
```

- [ ] **Step 3: Commit**

```bash
git add packages/shared/src/types/theme.ts packages/shared/src/index.ts
git commit -m "feat: add theme type definitions"
```

### Task 2: Settings Type Updates

**Files:**
- Modify: `packages/shared/src/types/settings.ts`
- Modify: `packages/shared/src/constants.ts`

- [ ] **Step 1: Add AppearanceSettings and update AppSettings**

In `packages/shared/src/types/settings.ts`, add:

```typescript
interface AppearanceSettings {
    theme: string;
}
```

Add `appearance: AppearanceSettings` to `AppSettings` interface.

Add `appearance?: Partial<AppearanceSettings>` to `SettingsUpdatePayload` interface.

`appearance.theme` stores the canonical theme id/slug (for example `catppuccin-mocha`), not the display name.

- [ ] **Step 2: Add theme messages and default to constants**

In `packages/shared/src/constants.ts`, add to `MSG` object:

```typescript
    // Themes
    THEMES_LIST: "theme:list",
    THEME_IMPORT_SCAN: "theme:import-scan",
    THEME_IMPORT: "theme:import",
    THEME_BROWSE_LIST: "theme:browse-list",
    THEME_DOWNLOAD: "theme:download",
    THEME_DELETE: "theme:delete",
```

Add after the MSG object:
```typescript
export const DEFAULT_THEME_ID = "catppuccin-mocha";
```

- [ ] **Step 3: Add theme WebSocket payload/response types**

In `packages/shared/src/types/ws.ts`, add theme-related payload and response types:

```typescript
export interface ThemeListResponse {
    themes: ThemeRecord[];
}

export interface ThemeImportPayload {
    theme: ThemeSource;
}

export interface ThemeImportScanResponse {
    apps: Array<{ app: string; themes: ThemeSource[] }>;
}

export interface ThemeDeletePayload {
    id: string;
}

export interface OnlineThemeRecord {
    id: string;
    name: string;
    author?: string;
    downloadUrl: string;
}

export interface ThemeBrowseListResponse {
    themes: OnlineThemeRecord[];
}

export interface ThemeDownloadPayload {
    id: string;
    url: string;
    name: string;
}
```

These are used by the backend handlers in Task 8 instead of anonymous inline casts.

- [ ] **Step 4: Commit**

```bash
git add packages/shared/src/types/settings.ts packages/shared/src/constants.ts packages/shared/src/types/ws.ts
git commit -m "feat: add appearance settings, theme message constants, and WS types"
```

### Task 3: Color Utilities

**Files:**
- Create: `packages/shared/src/themes/color-utils.ts`
- Create: `packages/shared/tests/themes/color-utils.test.ts`

- [ ] **Step 1: Write failing tests for color utilities**

```typescript
// packages/shared/tests/themes/color-utils.test.ts
import { describe, it, expect } from "bun:test";
import { lighten, hexToRgba } from "../../src/themes/color-utils";

describe("lighten", () => {
    it("lightens a dark color by 10%", () => {
        const result = lighten("#44475a", 0.1);
        // Each channel increases by (255 - channel) * 0.1
        // R: 68 + (255-68)*0.1 = 68 + 18.7 = 87 → #57
        // G: 71 + (255-71)*0.1 = 71 + 18.4 = 89 → #59
        // B: 90 + (255-90)*0.1 = 90 + 16.5 = 107 → #6b
        expect(result).toBe("#57596b");
    });

    it("does not exceed #ffffff", () => {
        expect(lighten("#ffffff", 0.5)).toBe("#ffffff");
    });

    it("lightens black", () => {
        expect(lighten("#000000", 0.5)).toBe("#808080");
    });
});

describe("hexToRgba", () => {
    it("converts hex to rgba string", () => {
        expect(hexToRgba("#1e1e2e", 0.5)).toBe("rgba(30, 30, 46, 0.5)");
    });

    it("handles full opacity", () => {
        expect(hexToRgba("#ff0000", 1)).toBe("rgba(255, 0, 0, 1)");
    });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/shared && bun test tests/themes/color-utils.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement color utilities**

```typescript
// packages/shared/src/themes/color-utils.ts

interface RGB {
    r: number;
    g: number;
    b: number;
}

function parseHex(hex: string): RGB {
    const h = hex.replace("#", "");
    if (h.length === 3) {
        return {
            r: parseInt(h[0] + h[0], 16),
            g: parseInt(h[1] + h[1], 16),
            b: parseInt(h[2] + h[2], 16),
        };
    }
    return {
        r: parseInt(h.slice(0, 2), 16),
        g: parseInt(h.slice(2, 4), 16),
        b: parseInt(h.slice(4, 6), 16),
    };
}

function toHex(n: number): string {
    return Math.round(Math.min(255, Math.max(0, n)))
        .toString(16)
        .padStart(2, "0");
}

function lighten(hex: string, amount: number): string {
    const { r, g, b } = parseHex(hex);
    return `#${toHex(r + (255 - r) * amount)}${toHex(g + (255 - g) * amount)}${toHex(b + (255 - b) * amount)}`;
}

function hexToRgba(hex: string, alpha: number): string {
    const { r, g, b } = parseHex(hex);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
```

Export `lighten` and `hexToRgba`. Keep `parseHex` unexported — it's internal to the module (used by `lighten` and `hexToRgba` but not needed externally).

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/shared && bun test tests/themes/color-utils.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/themes/color-utils.ts packages/shared/tests/themes/color-utils.test.ts
git commit -m "feat: add color utility functions (lighten, hexToRgba)"
```

### Task 4: Derivation Engine

**Files:**
- Create: `packages/shared/src/themes/derive.ts`
- Create: `packages/shared/tests/themes/derive.test.ts`

- [ ] **Step 1: Write failing tests for derivation engine**

Create `packages/shared/tests/themes/derive.test.ts`. Test with a Dracula-like theme source:

```typescript
import { describe, it, expect } from "bun:test";
import { deriveTheme } from "../../src/themes/derive";
import type { ThemeSource } from "../../src/types/theme";

const dracula: ThemeSource = {
    version: 1,
    name: "Dracula",
    origin: "bundled",
    colors: {
        foreground: "#f8f8f2",
        background: "#282a36",
        cursor: "#f8f8f2",
        cursorText: "#282a36",
        selection: "#44475a",
        selectionText: "#f8f8f2",
        ansi: {
            black: "#21222c",
            red: "#ff5555",
            green: "#50fa7b",
            yellow: "#f1fa8c",
            blue: "#bd93f9",
            magenta: "#ff79c6",
            cyan: "#8be9fd",
            white: "#f8f8f2",
            brightBlack: "#6272a4",
            brightRed: "#ff6e6e",
            brightGreen: "#69ff94",
            brightYellow: "#ffffa5",
            brightBlue: "#d6acff",
            brightMagenta: "#ff92df",
            brightCyan: "#a4ffff",
            brightWhite: "#ffffff",
        },
    },
};

describe("deriveTheme", () => {
    it("maps background and foreground directly", () => {
        const resolved = deriveTheme(dracula);
        expect(resolved.css["--background"]).toBe("#282a36");
        expect(resolved.css["--foreground"]).toBe("#f8f8f2");
    });

    it("maps card to ansi.black", () => {
        const resolved = deriveTheme(dracula);
        expect(resolved.css["--card"]).toBe("#21222c");
    });

    it("maps accent to ansi.blue", () => {
        const resolved = deriveTheme(dracula);
        expect(resolved.css["--accent"]).toBe("#bd93f9");
    });

    it("maps destructive to ansi.red", () => {
        const resolved = deriveTheme(dracula);
        expect(resolved.css["--destructive"]).toBe("#ff5555");
    });

    it("maps muted-foreground to ansi.brightBlack", () => {
        const resolved = deriveTheme(dracula);
        expect(resolved.css["--muted-foreground"]).toBe("#6272a4");
    });

    it("derives border by lightening selection ~10%", () => {
        const resolved = deriveTheme(dracula);
        // #44475a lightened 10% → #57596b
        expect(resolved.css["--border"]).toBe("#57596b");
    });

    it("derives island-base as background with 50% opacity", () => {
        const resolved = deriveTheme(dracula);
        expect(resolved.css["--island-base"]).toBe("rgba(40, 42, 54, 0.5)");
    });

    it("produces xterm theme with all 20 colors", () => {
        const resolved = deriveTheme(dracula);
        expect(resolved.xterm.background).toBe("#282a36");
        expect(resolved.xterm.foreground).toBe("#f8f8f2");
        expect(resolved.xterm.cursor).toBe("#f8f8f2");
        expect(resolved.xterm.cursorAccent).toBe("#282a36");
        expect(resolved.xterm.red).toBe("#ff5555");
        expect(resolved.xterm.brightCyan).toBe("#a4ffff");
    });

    it("applies overrides over derived values", () => {
        const withOverrides: ThemeSource = {
            ...dracula,
            overrides: { "--border": "#999999" },
        };
        const resolved = deriveTheme(withOverrides);
        expect(resolved.css["--border"]).toBe("#999999");
    });

    it("preserves the source in resolved theme", () => {
        const resolved = deriveTheme(dracula);
        expect(resolved.source.name).toBe("Dracula");
    });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/shared && bun test tests/themes/derive.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement derivation engine**

Create `packages/shared/src/themes/derive.ts`:

```typescript
import type { ThemeSource, ResolvedTheme, CssVariables, XtermTheme } from "../types/theme";
import { lighten, hexToRgba } from "./color-utils";

function deriveTheme(source: ThemeSource): ResolvedTheme {
    const { colors } = source;
    const { ansi } = colors;

    const derived: CssVariables = {
        "--background": colors.background,
        "--foreground": colors.foreground,
        "--card": ansi.black,
        "--card-foreground": colors.foreground,
        "--popover": colors.selection,
        "--popover-foreground": colors.foreground,
        "--primary": colors.foreground,
        "--primary-foreground": colors.background,
        "--secondary": colors.selection,
        "--secondary-foreground": colors.foreground,
        "--accent": ansi.blue,
        "--accent-foreground": colors.background,
        "--muted": colors.selection,
        "--muted-foreground": ansi.brightBlack,
        "--destructive": ansi.red,
        "--destructive-foreground": colors.background,
        "--success": ansi.green,
        "--success-foreground": colors.background,
        "--warning": ansi.yellow,
        "--warning-foreground": colors.background,
        "--info": ansi.cyan,
        "--info-foreground": colors.background,
        "--border": lighten(colors.selection, 0.1),
        "--input": colors.selection,
        "--ring": ansi.blue,
        "--island-base": hexToRgba(colors.background, 0.5),
        "--chart-1": ansi.blue,
        "--chart-2": ansi.green,
        "--chart-3": ansi.magenta,
        "--chart-4": ansi.cyan,
        "--chart-5": ansi.yellow,
        "--sidebar-background": colors.background,
        "--sidebar-foreground": colors.foreground,
        "--sidebar-primary": colors.foreground,
        "--sidebar-primary-foreground": colors.background,
        "--sidebar-accent": ansi.blue,
        "--sidebar-accent-foreground": colors.background,
        "--sidebar-border": lighten(colors.selection, 0.1),
        "--sidebar-ring": ansi.blue,
    };

    // Apply overrides (typed as Partial<CssVariables>, so spread is safe)
    const css: CssVariables = source.overrides
        ? { ...derived, ...source.overrides }
        : derived;

    const xterm: XtermTheme = {
        background: colors.background,
        foreground: colors.foreground,
        cursor: colors.cursor,
        cursorAccent: colors.background,
        selectionBackground: colors.selection,
        black: ansi.black,
        red: ansi.red,
        green: ansi.green,
        yellow: ansi.yellow,
        blue: ansi.blue,
        magenta: ansi.magenta,
        cyan: ansi.cyan,
        white: ansi.white,
        brightBlack: ansi.brightBlack,
        brightRed: ansi.brightRed,
        brightGreen: ansi.brightGreen,
        brightYellow: ansi.brightYellow,
        brightBlue: ansi.brightBlue,
        brightMagenta: ansi.brightMagenta,
        brightCyan: ansi.brightCyan,
        brightWhite: ansi.brightWhite,
    };

    return { source, css, xterm };
}
```

Export `deriveTheme`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/shared && bun test tests/themes/derive.test.ts`
Expected: PASS

- [ ] **Step 5: Add theme module exports to shared index**

In `packages/shared/src/index.ts`, add:
```typescript
export * from "./themes/color-utils";
export * from "./themes/derive";
```

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/themes/derive.ts packages/shared/tests/themes/derive.test.ts packages/shared/src/index.ts
git commit -m "feat: add theme derivation engine"
```

### Task 5: Bundled Theme JSON Files

**Files:**
- Create: `packages/shared/src/themes/bundled/catppuccin-mocha.json`
- Create: `packages/shared/src/themes/bundled/dracula.json`
- Create: `packages/shared/src/themes/bundled/nord.json`
- Create: `packages/shared/src/themes/bundled/gruvbox-dark.json`
- Create: `packages/shared/src/themes/bundled/tokyo-night.json`
- Create: `packages/shared/src/themes/bundled/solarized-dark.json`
- Create: `packages/shared/src/themes/index.ts`

- [ ] **Step 1: Create bundled theme JSON files**

Each file follows the `ThemeSource` format. Example for Catppuccin Mocha:

```json
{
    "version": 1,
    "name": "Catppuccin Mocha",
    "author": "Catppuccin",
    "origin": "bundled",
    "colors": {
        "foreground": "#cdd6f4",
        "background": "#1e1e2e",
        "cursor": "#f5e0dc",
        "cursorText": "#1e1e2e",
        "selection": "#313244",
        "selectionText": "#cdd6f4",
        "ansi": {
            "black": "#181825",
            "red": "#f38ba8",
            "green": "#a6e3a1",
            "yellow": "#f9e2af",
            "blue": "#89b4fa",
            "magenta": "#cba6f7",
            "cyan": "#94e2d5",
            "white": "#bac2de",
            "brightBlack": "#585b70",
            "brightRed": "#f38ba8",
            "brightGreen": "#a6e3a1",
            "brightYellow": "#f9e2af",
            "brightBlue": "#89b4fa",
            "brightMagenta": "#cba6f7",
            "brightCyan": "#94e2d5",
            "brightWhite": "#a6adc8"
        }
    }
}
```

Create similar files for Dracula, Nord, Gruvbox Dark, Tokyo Night, Solarized Dark using their official terminal color palettes. Research correct hex values from each project's official docs/repos.

- [ ] **Step 2: Create themes index**

```typescript
// packages/shared/src/themes/index.ts
import type { ThemeRecord } from "../types/theme";

import catppuccinMocha from "./bundled/catppuccin-mocha.json";
import dracula from "./bundled/dracula.json";
import nord from "./bundled/nord.json";
import gruvboxDark from "./bundled/gruvbox-dark.json";
import tokyoNight from "./bundled/tokyo-night.json";
import solarizedDark from "./bundled/solarized-dark.json";

const bundledThemes = [
    { id: "catppuccin-mocha", source: catppuccinMocha },
    { id: "dracula", source: dracula },
    { id: "nord", source: nord },
    { id: "gruvbox-dark", source: gruvboxDark },
    { id: "tokyo-night", source: tokyoNight },
    { id: "solarized-dark", source: solarizedDark },
] satisfies ThemeRecord[];
```

Export `bundledThemes`. Add to `packages/shared/src/index.ts`:
```typescript
export { bundledThemes } from "./themes/index";
```

- [ ] **Step 3: Commit**

```bash
git add packages/shared/src/themes/
git commit -m "feat: add bundled theme definitions (6 themes)"
```

---

## Chunk 2: Backend — Config, Settings Store, Theme Service, Handlers

### Task 6: Backend Config & Settings Store Updates

**Files:**
- Modify: `packages/backend/src/config.ts:9-21`
- Modify: `packages/backend/src/services/settings-store.ts:10-57,83-108`
- Modify: `packages/backend/tests/services/settings-store.test.ts`

- [ ] **Step 1: Update config.ts**

Add `themesDir` to the config object:
```typescript
themesDir: join(CONFIG_DIR, "themes"),
```

Add to `ensureDirectories()`:
```typescript
await mkdir(config.themesDir, { recursive: true });
```

- [ ] **Step 2: Update settings-store.ts defaults and merge logic**

Add to `DEFAULTS`:
```typescript
appearance: {
    theme: "catppuccin-mocha",
},
```

Add to `createDefaultSettings()`:
```typescript
appearance: { ...DEFAULTS.appearance },
```

Add to `get()` return merge:
```typescript
appearance: { ...defaults.appearance, ...parsed.appearance },
```

Add to `update()`:
```typescript
if (partial.appearance) {
    Object.assign(current.appearance, partial.appearance);
}
```

Import `DEFAULT_THEME_ID` from shared and use it instead of the string literal. This value is the persisted canonical id, not the theme display name.

- [ ] **Step 3: Update settings-store tests**

Add `appearance` field to all expected results in `settings-store.test.ts`:
```typescript
const DEFAULT_APPEARANCE = { theme: "catppuccin-mocha" };
```

Add to every `toEqual` block: `appearance: DEFAULT_APPEARANCE`.

Add a new test:
```typescript
it("persists appearance.theme setting", async () => {
    const result = await store.update({
        appearance: { theme: "dracula" },
    });
    expect(result.appearance.theme).toBe("dracula");
    expect((await store.get()).appearance.theme).toBe("dracula");
});
```

- [ ] **Step 4: Run tests**

Run: `cd packages/backend && bun test tests/services/settings-store.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/backend/src/config.ts packages/backend/src/services/settings-store.ts packages/backend/tests/services/settings-store.test.ts
git commit -m "feat: add appearance settings and themes directory to config"
```

### Task 7: Theme Service

**Files:**
- Create: `packages/backend/src/services/theme-service.ts`
- Create: `packages/backend/tests/services/theme-service.test.ts`

- [ ] **Step 1: Write failing tests for ThemeService**

```typescript
// packages/backend/tests/services/theme-service.test.ts
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, writeFile, mkdir } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { ThemeService } from "../../src/services/theme-service";

describe("ThemeService", () => {
    let tempDir: string;
    let service: ThemeService;

    beforeEach(async () => {
        tempDir = await mkdtemp(join(tmpdir(), "taskflow-themes-"));
        service = new ThemeService(tempDir);
    });

    afterEach(async () => {
        await rm(tempDir, { recursive: true, force: true });
    });

    it("lists bundled themes", async () => {
        const themes = await service.listAll();
        expect(themes.length).toBeGreaterThanOrEqual(6);
        expect(themes.find((t) => t.id === "catppuccin-mocha" && t.source.name === "Catppuccin Mocha")).toBeTruthy();
        expect(themes.find((t) => t.id === "dracula" && t.source.name === "Dracula")).toBeTruthy();
    });

    it("lists user themes from directory", async () => {
        await writeFile(
            join(tempDir, "custom.json"),
            JSON.stringify({
                version: 1,
                name: "Custom",
                origin: "custom",
                colors: {
                    foreground: "#ffffff",
                    background: "#000000",
                    cursor: "#ffffff",
                    cursorText: "#000000",
                    selection: "#333333",
                    selectionText: "#ffffff",
                    ansi: {
                        black: "#000000", red: "#ff0000", green: "#00ff00",
                        yellow: "#ffff00", blue: "#0000ff", magenta: "#ff00ff",
                        cyan: "#00ffff", white: "#ffffff",
                        brightBlack: "#808080", brightRed: "#ff0000",
                        brightGreen: "#00ff00", brightYellow: "#ffff00",
                        brightBlue: "#0000ff", brightMagenta: "#ff00ff",
                        brightCyan: "#00ffff", brightWhite: "#ffffff",
                    },
                },
            }),
        );

        const themes = await service.listAll();
        expect(themes.find((t) => t.id === "custom" && t.source.name === "Custom")).toBeTruthy();
    });

    it("saves a theme to user directory", async () => {
        const theme = {
            version: 1 as const,
            name: "Saved Theme",
            origin: "imported" as const,
            colors: {
                foreground: "#ffffff",
                background: "#000000",
                cursor: "#ffffff",
                cursorText: "#000000",
                selection: "#333333",
                selectionText: "#ffffff",
                ansi: {
                    black: "#000000", red: "#ff0000", green: "#00ff00",
                    yellow: "#ffff00", blue: "#0000ff", magenta: "#ff00ff",
                    cyan: "#00ffff", white: "#ffffff",
                    brightBlack: "#808080", brightRed: "#ff0000",
                    brightGreen: "#00ff00", brightYellow: "#ffff00",
                    brightBlue: "#0000ff", brightMagenta: "#ff00ff",
                    brightCyan: "#00ffff", brightWhite: "#ffffff",
                },
            },
        };

        await service.save(theme);
        const themes = await service.listAll();
        expect(themes.find((t) => t.id === "saved-theme" && t.source.name === "Saved Theme")).toBeTruthy();
    });

    it("skips invalid JSON files gracefully", async () => {
        await writeFile(join(tempDir, "bad.json"), "not json");
        const themes = await service.listAll();
        // Should still return bundled themes without error
        expect(themes.length).toBeGreaterThanOrEqual(6);
    });

    it("skips files with unknown version", async () => {
        await writeFile(
            join(tempDir, "future.json"),
            JSON.stringify({ version: 99, name: "Future" }),
        );
        const themes = await service.listAll();
        expect(themes.find((t) => t.id === "future")).toBeFalsy();
    });

    it("deletes a user theme", async () => {
        const theme = {
            version: 1 as const,
            name: "To Delete",
            origin: "custom" as const,
            colors: {
                foreground: "#ffffff", background: "#000000",
                cursor: "#ffffff", cursorText: "#000000",
                selection: "#333333", selectionText: "#ffffff",
                ansi: {
                    black: "#000000", red: "#ff0000", green: "#00ff00",
                    yellow: "#ffff00", blue: "#0000ff", magenta: "#ff00ff",
                    cyan: "#00ffff", white: "#ffffff",
                    brightBlack: "#808080", brightRed: "#ff0000",
                    brightGreen: "#00ff00", brightYellow: "#ffff00",
                    brightBlue: "#0000ff", brightMagenta: "#ff00ff",
                    brightCyan: "#00ffff", brightWhite: "#ffffff",
                },
            },
        };
        await service.save(theme);
        await service.delete("to-delete");
        const themes = await service.listAll();
        expect(themes.find((t) => t.id === "to-delete")).toBeFalsy();
    });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/backend && bun test tests/services/theme-service.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement ThemeService**

```typescript
// packages/backend/src/services/theme-service.ts
import { readdir, readFile, writeFile, unlink } from "fs/promises";
import { join } from "path";
import { bundledThemes } from "@taskflow/shared";
import type { ThemeRecord, ThemeSource } from "@taskflow/shared";
import { slugify } from "../utils/slugify";

function isValidThemeSource(value: unknown): value is ThemeSource {
    if (typeof value !== "object" || value === null) return false;
    const obj = value as Record<string, unknown>;
    return obj.version === 1
        && typeof obj.name === "string"
        && typeof obj.colors === "object"
        && obj.colors !== null;
}

class ThemeService {
    constructor(private themesDir: string) {}

    async listAll(): Promise<ThemeRecord[]> {
        const userThemes = await this.loadUserThemes();
        return [...bundledThemes, ...userThemes];
    }

    async save(theme: ThemeSource, preferredId?: string): Promise<ThemeRecord> {
        const id = preferredId ?? slugify(theme.name);
        const filename = `${id}.json`;
        await writeFile(
            join(this.themesDir, filename),
            JSON.stringify(theme, null, 2),
        );
        return { id, source: theme };
    }

    async delete(id: string): Promise<void> {
        const filename = `${id}.json`;
        await unlink(join(this.themesDir, filename)).catch(() => {});
    }

    idFor(name: string): string {
        return slugify(name);
    }

    private async loadUserThemes(): Promise<ThemeRecord[]> {
        const themes: ThemeRecord[] = [];
        let entries: string[];
        try {
            entries = await readdir(this.themesDir);
        } catch {
            return themes;
        }

        for (const entry of entries) {
            if (!entry.endsWith(".json")) continue;
            try {
                const raw = await readFile(join(this.themesDir, entry), "utf-8");
                const parsed = JSON.parse(raw);
                if (!isValidThemeSource(parsed)) continue;
                themes.push({
                    id: entry.replace(/\.json$/, ""),
                    source: parsed,
                });
            } catch {
                // Skip invalid files
            }
        }
        return themes;
    }
}
```

Export `ThemeService`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/backend && bun test tests/services/theme-service.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/backend/src/services/theme-service.ts packages/backend/tests/services/theme-service.test.ts
git commit -m "feat: add ThemeService for loading and managing themes"
```

### Task 8: Theme Handlers

**Files:**
- Create: `packages/backend/src/handlers/theme.ts`
- Modify: `packages/backend/src/index.ts`

- [ ] **Step 1: Create theme WebSocket handlers**

```typescript
// packages/backend/src/handlers/theme.ts
import { MSG } from "@taskflow/shared";
import type {
    ThemeBrowseListResponse,
    ThemeDeletePayload,
    ThemeDownloadPayload,
    ThemeImportPayload,
    ThemeListResponse,
    ThemeSource,
} from "@taskflow/shared";
import type { Router } from "../ws/router";
import type { ThemeService } from "../services/theme-service";

function registerThemeHandlers(router: Router, themeService: ThemeService): void {
    router.register(MSG.THEMES_LIST, async () => {
        const themes = await themeService.listAll();
        return { themes } satisfies ThemeListResponse;
    });

    router.register(MSG.THEME_IMPORT, async (payload) => {
        const { theme } = payload as ThemeImportPayload;
        await themeService.save(theme);
        const themes = await themeService.listAll();
        return { themes } satisfies ThemeListResponse;
    });

    router.register(MSG.THEME_DELETE, async (payload) => {
        const { id } = payload as ThemeDeletePayload;
        await themeService.delete(id);
        const themes = await themeService.listAll();
        return { themes } satisfies ThemeListResponse;
    });

    router.register(MSG.THEME_BROWSE_LIST, async () => {
        const themes = [
            { id: "dracula-default", name: "Dracula", downloadUrl: "https://terminalcolors.com/downloads/alacritty/dracula-default.toml" },
            { id: "nord", name: "Nord", downloadUrl: "https://terminalcolors.com/downloads/alacritty/nord.toml" },
            { id: "tokyo-night", name: "Tokyo Night", downloadUrl: "https://terminalcolors.com/downloads/alacritty/tokyo-night.toml" },
        ];
        return { themes } satisfies ThemeBrowseListResponse;
    });

    router.register(MSG.THEME_DOWNLOAD, async (payload) => {
        const { id, url, name } = payload as ThemeDownloadPayload;
        const response = await fetch(url);
        const toml = await response.text();
        // Parse Alacritty TOML into ThemeSource (using the Alacritty parser from Chunk 5)
        // For now, import parseAlacrittyToml from theme-parsers/alacritty
        const { parseAlacrittyToml } = await import("../services/theme-parsers/alacritty");
        const parsed = parseAlacrittyToml(toml, name);
        const theme: ThemeSource = { ...parsed, origin: "online" };
        await themeService.save(theme, id);
        const themes = await themeService.listAll();
        return { themes } satisfies ThemeListResponse;
    });
}
```

Export `registerThemeHandlers`.

- [ ] **Step 2: Register handlers in backend index.ts**

In `packages/backend/src/index.ts`:
- Import `registerThemeHandlers` and `ThemeService`
- Create `ThemeService` instance with `config.themesDir`
- Call `registerThemeHandlers(router, themeService)` alongside other handler registrations

- [ ] **Step 3: Commit**

```bash
git add packages/backend/src/handlers/theme.ts packages/backend/src/index.ts
git commit -m "feat: add theme WebSocket handlers and register in backend"
```

---

## Chunk 3: UI Integration — Theme Store, useTheme Hook, Monaco Setup, Terminal/Editor Updates

### Task 9: UI Store Updates

**Files:**
- Modify: `packages/ui/src/stores/ui-store.ts:14-55`

- [ ] **Step 1: Add appearanceOpen state to UIStore**

Add to the interface:
```typescript
appearanceOpen: boolean;
setAppearanceOpen(open: boolean): void;
toggleAppearance(): void;
```

Add to the store:
```typescript
appearanceOpen: false,
setAppearanceOpen(open) {
    set({ appearanceOpen: open });
},
toggleAppearance() {
    set((s) => ({ appearanceOpen: !s.appearanceOpen }));
},
```

- [ ] **Step 2: Commit**

```bash
git add packages/ui/src/stores/ui-store.ts
git commit -m "feat: add appearance dialog state to UI store"
```

### Task 10: Theme Store

**Files:**
- Create: `packages/ui/src/stores/theme-store.ts`

- [ ] **Step 1: Create theme store**

```typescript
// packages/ui/src/stores/theme-store.ts
import { create } from "zustand";
import { MSG, DEFAULT_THEME_ID } from "@taskflow/shared";
import type { ResolvedTheme, ThemeListResponse, ThemeRecord, ThemeSource } from "@taskflow/shared";
import { deriveTheme } from "@taskflow/shared";
import { sendRequest } from "../hooks/useWebSocket";
import { useSettingsStore } from "./settings-store";

interface ThemeStore {
    themes: ThemeRecord[];
    activeThemeId: string | null;
    resolved: ResolvedTheme | null;
    fetchThemes(): Promise<void>;
    activateTheme(themeId: string): Promise<void>;
    importTheme(theme: ThemeSource): Promise<void>;
    deleteTheme(themeId: string): Promise<void>;
}

export const useThemeStore = create<ThemeStore>((set, get) => ({
    themes: [],
    activeThemeId: null,
    resolved: null,

    async fetchThemes() {
        const { themes } = await sendRequest<ThemeListResponse>(MSG.THEMES_LIST);

        // Resolve the active theme using the persisted canonical id.
        const activeThemeId =
            useSettingsStore.getState().settings?.appearance?.theme ?? DEFAULT_THEME_ID;
        const record = themes.find((t) => t.id === activeThemeId)
            ?? themes.find((t) => t.id === DEFAULT_THEME_ID)
            ?? themes[0];
        set({
            themes,
            activeThemeId: record?.id ?? null,
            resolved: record ? deriveTheme(record.source) : null,
        });
    },

    async activateTheme(themeId: string) {
        const record = get().themes.find((t) => t.id === themeId);
        if (!record) return;
        set({
            activeThemeId: record.id,
            resolved: deriveTheme(record.source),
        });
        await useSettingsStore.getState().updateSettings({
            appearance: { theme: themeId },
        });
    },

    async importTheme(theme: ThemeSource) {
        const { themes } = await sendRequest<ThemeListResponse>(MSG.THEME_IMPORT, { theme });
        set({ themes });
    },

    async deleteTheme(themeId: string) {
        const deletingActive = themeId === get().activeThemeId;
        const { themes } = await sendRequest<ThemeListResponse>(MSG.THEME_DELETE, { id: themeId });
        const fallbackId = deletingActive ? DEFAULT_THEME_ID : get().activeThemeId;
        const record = themes.find((t) => t.id === fallbackId) ?? themes[0] ?? null;

        set({
            themes,
            activeThemeId: record?.id ?? null,
            resolved: record ? deriveTheme(record.source) : null,
        });

        if (deletingActive && record) {
            await useSettingsStore.getState().updateSettings({
                appearance: { theme: record.id },
            });
        }
    },
}));
```

- [ ] **Step 2: Commit**

```bash
git add packages/ui/src/stores/theme-store.ts
git commit -m "feat: add Zustand theme store"
```

### Task 11: Monaco Theme Setup

**Files:**
- Create: `packages/ui/src/lib/monaco-theme.ts`

- [ ] **Step 1: Create module-level Monaco theme registration**

```typescript
// packages/ui/src/lib/monaco-theme.ts
import * as monaco from "monaco-editor";
import type { ResolvedTheme } from "@taskflow/shared";

const THEME_NAME = "taskflow";

// Default theme registered at module load time (Catppuccin Mocha fallback).
// This ensures "taskflow" exists before any EditorPane mounts.
monaco.editor.defineTheme(THEME_NAME, {
    base: "vs-dark",
    inherit: false,
    rules: [
        { token: "", foreground: "cdd6f4", background: "1e1e2e" },
        { token: "comment", foreground: "585b70", fontStyle: "italic" },
        { token: "keyword", foreground: "89b4fa" },
        { token: "string", foreground: "a6e3a1" },
        { token: "number", foreground: "f9e2af" },
        { token: "type", foreground: "cba6f7" },
        { token: "function", foreground: "89b4fa" },
        { token: "variable", foreground: "cdd6f4" },
        { token: "constant", foreground: "f38ba8" },
        { token: "operator", foreground: "94e2d5" },
        { token: "delimiter", foreground: "585b70" },
    ],
    colors: {
        "editor.background": "#1e1e2e",
        "editor.foreground": "#cdd6f4",
        "editor.selectionBackground": "#31324480",
        "editor.lineHighlightBackground": "#181825",
        "editorCursor.foreground": "#f5e0dc",
        "editorWhitespace.foreground": "#31324440",
        "editorIndentGuide.background": "#31324440",
        "editorLineNumber.foreground": "#585b70",
        "editorLineNumber.activeForeground": "#cdd6f4",
    },
});

function updateMonacoTheme(resolved: ResolvedTheme): void {
    const { css, xterm } = resolved;
    const fg = css["--foreground"].replace("#", "");
    const bg = css["--background"];
    const comment = css["--muted-foreground"].replace("#", "");
    const keyword = css["--accent"].replace("#", "");
    const string = xterm.green.replace("#", "");
    const number = xterm.yellow.replace("#", "");
    const type = xterm.magenta.replace("#", "");
    const constant = xterm.red.replace("#", "");
    const operator = xterm.cyan.replace("#", "");

    monaco.editor.defineTheme(THEME_NAME, {
        base: "vs-dark",
        inherit: false,
        rules: [
            { token: "", foreground: fg, background: bg.replace("#", "") },
            { token: "comment", foreground: comment, fontStyle: "italic" },
            { token: "keyword", foreground: keyword },
            { token: "string", foreground: string },
            { token: "number", foreground: number },
            { token: "type", foreground: type },
            { token: "function", foreground: keyword },
            { token: "variable", foreground: fg },
            { token: "constant", foreground: constant },
            { token: "operator", foreground: operator },
            { token: "delimiter", foreground: comment },
        ],
        colors: {
            "editor.background": bg,
            "editor.foreground": css["--foreground"],
            "editor.selectionBackground": css["--secondary"] + "80",
            "editor.lineHighlightBackground": css["--card"],
            "editorCursor.foreground": resolved.xterm.cursor,
            "editorWhitespace.foreground": css["--secondary"] + "40",
            "editorIndentGuide.background": css["--secondary"] + "40",
            "editorLineNumber.foreground": css["--muted-foreground"],
            "editorLineNumber.activeForeground": css["--foreground"],
        },
    });

    monaco.editor.setTheme(THEME_NAME);
}

const MONACO_THEME_NAME = THEME_NAME;
```

Export `updateMonacoTheme` and `MONACO_THEME_NAME`.

- [ ] **Step 2: Commit**

```bash
git add packages/ui/src/lib/monaco-theme.ts
git commit -m "feat: add module-level Monaco theme registration"
```

### Task 12: useTheme Hook

**Files:**
- Create: `packages/ui/src/hooks/useTheme.ts`

- [ ] **Step 1: Create useTheme hook**

```typescript
// packages/ui/src/hooks/useTheme.ts
import { useEffect } from "react";
import { useThemeStore } from "../stores/theme-store";
import { updateMonacoTheme } from "../lib/monaco-theme";

function useTheme(): void {
    const resolved = useThemeStore((s) => s.resolved);

    useEffect(() => {
        if (!resolved) return;

        // Apply CSS variables to document root
        const root = document.documentElement;
        for (const [key, value] of Object.entries(resolved.css)) {
            root.style.setProperty(key, value);
        }

        // Update Monaco theme
        updateMonacoTheme(resolved);
    }, [resolved]);
}
```

Export `useTheme`.

- [ ] **Step 2: Commit**

```bash
git add packages/ui/src/hooks/useTheme.ts
git commit -m "feat: add useTheme hook for applying theme to DOM and Monaco"
```

### Task 13: TerminalPane Integration

**Files:**
- Modify: `packages/ui/src/components/panes/TerminalPane.tsx:376-426`

- [ ] **Step 1: Rewrite getTerminalTheme**

Replace the existing `getCssVar` helper and `getTerminalTheme` function. Import `useThemeStore` at the top of the file.

Replace `getTerminalTheme()` with a function that reads from the theme store:

```typescript
function getTerminalTheme(): Record<string, string> {
    const resolved = useThemeStore.getState().resolved;
    if (!resolved) {
        // Fallback to CSS var approach during initial load
        return {
            background: getCssVar("--card"),
            foreground: getCssVar("--foreground"),
            cursor: getCssVar("--foreground"),
            cursorAccent: getCssVar("--card"),
            selectionBackground: getCssVar("--muted"),
            black: getCssVar("--muted"),
            red: getCssVar("--destructive"),
            green: getCssVar("--success"),
            yellow: getCssVar("--warning"),
            blue: getCssVar("--accent"),
            magenta: getCssVar("--accent"),
            cyan: getCssVar("--info"),
            white: getCssVar("--foreground"),
            brightBlack: getCssVar("--muted-foreground"),
            brightRed: getCssVar("--destructive"),
            brightGreen: getCssVar("--success"),
            brightYellow: getCssVar("--warning"),
            brightBlue: getCssVar("--accent"),
            brightMagenta: getCssVar("--accent"),
            brightCyan: getCssVar("--info"),
            brightWhite: getCssVar("--foreground"),
        };
    }
    return { ...resolved.xterm };
}
```

- [ ] **Step 2: Add theme change subscription**

Inside the `TerminalPane` component, add an effect that re-themes all cached terminals when the resolved theme changes:

```typescript
const resolved = useThemeStore((s) => s.resolved);

useEffect(() => {
    if (!resolved) return;
    // Re-theme all cached terminals
    for (const [, cached] of terminalCache) {
        cached.term.options.theme = { ...resolved.xterm };
    }
}, [resolved]);
```

Note: the `terminalCache` is module-level so it's accessible. Adjust based on how it's exported/accessible within the file.

- [ ] **Step 3: Commit**

```bash
git add packages/ui/src/components/panes/TerminalPane.tsx
git commit -m "feat: integrate theme store into TerminalPane"
```

### Task 14: EditorPane Integration

**Files:**
- Modify: `packages/ui/src/components/panes/EditorPane.tsx:1,92`

- [ ] **Step 1: Replace vs-dark with taskflow theme**

Add import at top:
```typescript
import { MONACO_THEME_NAME } from "@/lib/monaco-theme";
```

Change line 92:
```typescript
// Before:
theme: "vs-dark",
// After:
theme: MONACO_THEME_NAME,
```

That's it — the `useTheme` hook handles re-theming globally via `monaco.editor.setTheme()`.

- [ ] **Step 2: Commit**

```bash
git add packages/ui/src/components/panes/EditorPane.tsx
git commit -m "feat: use dynamic Monaco theme in EditorPane"
```

### Task 15: App.tsx Integration

**Files:**
- Modify: `packages/ui/src/App.tsx`

- [ ] **Step 1: Wire useTheme and theme fetch into App**

Add imports:
```typescript
import { useTheme } from "@/hooks/useTheme";
import "@/lib/monaco-theme"; // Ensure module-level defineTheme runs
```

Inside the `App` component:
```typescript
export function App() {
    useTheme();
    // ... existing code ...
}
```

Theme fetch is triggered at startup, but it must happen **after** settings load so the persisted theme id is available before resolution. In `packages/ui/src/components/sidebar/TaskSidebar.tsx`, update the `useEffect` at line 39-44:

```typescript
useEffect(() => {
    if (!connected) return;
    void (async () => {
        await fetchSettings();
        await fetchThemes();
        await Promise.all([fetchProjects(), fetchTasks()]);
    })();
}, [connected, fetchProjects, fetchTasks, fetchSettings, fetchThemes]);
```

Add `fetchThemes` from `useThemeStore` to the destructured selectors at the top of the component:
```typescript
const fetchThemes = useThemeStore((s) => s.fetchThemes);
```

- [ ] **Step 2: Add AppearanceDialog to App**

Add import:
```typescript
import { AppearanceDialog } from "@/components/appearance/AppearanceDialog";
```

Add `<AppearanceDialog />` alongside `<SettingsModal />` in the JSX.

- [ ] **Step 3: Commit**

```bash
git add packages/ui/src/App.tsx
git commit -m "feat: wire useTheme hook and AppearanceDialog into App"
```

---

## Chunk 4: Appearance Dialog & Sidebar Button

### Task 16: ThemeCard Component

**Files:**
- Create: `packages/ui/src/components/appearance/ThemeCard.tsx`

- [ ] **Step 1: Create ThemeCard component**

Displays a theme preview card with:
- Color palette swatches (background, foreground, 8 ANSI colors)
- Theme name
- Origin badge (bundled/custom/imported)
- Active indicator (checkmark or highlighted border)
- Click handler to activate

```typescript
// packages/ui/src/components/appearance/ThemeCard.tsx
import type { ThemeRecord } from "@taskflow/shared";
import { cn } from "@/lib/utils";

interface ThemeCardProps {
    theme: ThemeRecord;
    isActive: boolean;
    onClick: () => void;
}

function ThemeCard({ theme, isActive, onClick }: ThemeCardProps) {
    const { source } = theme;
    const { colors } = source;
    const swatches = [
        colors.ansi.red,
        colors.ansi.green,
        colors.ansi.yellow,
        colors.ansi.blue,
        colors.ansi.magenta,
        colors.ansi.cyan,
    ];

    return (
        <button
            onClick={onClick}
            className={cn(
                "flex flex-col rounded-lg border p-3 text-left transition-colors",
                "hover:border-accent",
                isActive ? "border-accent bg-accent/10" : "border-border",
            )}
        >
            {/* Color preview */}
            <div
                className="mb-2 flex h-16 items-end gap-0.5 rounded-md p-2"
                style={{ backgroundColor: colors.background }}
            >
                <span
                    className="text-xs font-mono truncate"
                    style={{ color: colors.foreground }}
                >
                    ~/project $
                </span>
                <span
                    className="text-xs font-mono"
                    style={{ color: colors.ansi.green }}
                >
                    {" "}git status
                </span>
            </div>
            {/* Swatch row */}
            <div className="mb-2 flex gap-1">
                {swatches.map((color, i) => (
                    <div
                        key={i}
                        className="h-3 flex-1 rounded-sm"
                        style={{ backgroundColor: color }}
                    />
                ))}
            </div>
            {/* Name + badge */}
            <div className="flex items-center gap-2">
                <span className="text-sm font-medium truncate">{source.name}</span>
                {source.origin !== "bundled" && (
                    <span className="text-muted-foreground bg-muted rounded px-1.5 py-0.5 text-[10px]">
                        {source.origin}
                    </span>
                )}
            </div>
        </button>
    );
}
```

Export `ThemeCard`.

- [ ] **Step 2: Commit**

```bash
git add packages/ui/src/components/appearance/ThemeCard.tsx
git commit -m "feat: add ThemeCard preview component"
```

### Task 17: ThemeGrid Component

**Files:**
- Create: `packages/ui/src/components/appearance/ThemeGrid.tsx`

- [ ] **Step 1: Create ThemeGrid component**

```typescript
// packages/ui/src/components/appearance/ThemeGrid.tsx
import { useState, useMemo } from "react";
import { useThemeStore } from "@/stores/theme-store";
import { ThemeCard } from "./ThemeCard";
import { Input } from "@/components/ui/input";

function ThemeGrid() {
    const themes = useThemeStore((s) => s.themes);
    const activeThemeId = useThemeStore((s) => s.activeThemeId);
    const activateTheme = useThemeStore((s) => s.activateTheme);
    const [search, setSearch] = useState("");

    const filtered = useMemo(() => {
        if (!search) return themes;
        const lower = search.toLowerCase();
        return themes.filter((t) => t.source.name.toLowerCase().includes(lower));
    }, [themes, search]);

    return (
        <div className="flex flex-col gap-3">
            <Input
                placeholder="Search themes..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="h-8"
            />
            <div className="grid grid-cols-3 gap-3">
                {filtered.map((theme) => (
                    <ThemeCard
                        key={theme.id}
                        theme={theme}
                        isActive={theme.id === activeThemeId}
                        onClick={() => void activateTheme(theme.id)}
                    />
                ))}
            </div>
        </div>
    );
}
```

Export `ThemeGrid`.

- [ ] **Step 2: Commit**

```bash
git add packages/ui/src/components/appearance/ThemeGrid.tsx
git commit -m "feat: add ThemeGrid component"
```

### Task 18: ImportTab Component

**Files:**
- Create: `packages/ui/src/components/appearance/ImportTab.tsx`

- [ ] **Step 1: Create ImportTab component**

This is a placeholder for now — the full parsers come in Chunk 5. For now it shows detected terminal apps and a "From File..." button.

```typescript
// packages/ui/src/components/appearance/ImportTab.tsx

function ImportTab() {
    return (
        <div className="flex flex-col gap-4">
            <p className="text-muted-foreground text-sm">
                Import themes from your installed terminal apps.
            </p>
            <p className="text-muted-foreground text-xs">
                Coming soon: auto-detect iTerm2, Alacritty, Warp, Ghostty, Kitty, and Terminal.app themes.
            </p>
        </div>
    );
}
```

Export `ImportTab`.

- [ ] **Step 2: Commit**

```bash
git add packages/ui/src/components/appearance/ImportTab.tsx
git commit -m "feat: add ImportTab placeholder component"
```

### Task 19: BrowseOnlineTab Component

**Files:**
- Create: `packages/ui/src/components/appearance/BrowseOnlineTab.tsx`

- [ ] **Step 1: Create BrowseOnlineTab component**

Placeholder for now — full terminalcolors.com integration comes in Chunk 6.

```typescript
// packages/ui/src/components/appearance/BrowseOnlineTab.tsx

function BrowseOnlineTab() {
    return (
        <div className="flex flex-col gap-4">
            <p className="text-muted-foreground text-sm">
                Browse and install themes from terminalcolors.com.
            </p>
            <p className="text-muted-foreground text-xs">
                Coming soon.
            </p>
        </div>
    );
}
```

Export `BrowseOnlineTab`.

- [ ] **Step 2: Commit**

```bash
git add packages/ui/src/components/appearance/BrowseOnlineTab.tsx
git commit -m "feat: add BrowseOnlineTab placeholder component"
```

### Task 20: AppearanceDialog

**Files:**
- Create: `packages/ui/src/components/appearance/AppearanceDialog.tsx`

- [ ] **Step 1: Create AppearanceDialog**

Uses the same `Dialog` component pattern as `SettingsModal`. Three tabs: Themes, Import, Browse Online.

```typescript
// packages/ui/src/components/appearance/AppearanceDialog.tsx
import { useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useUIStore } from "@/stores/ui-store";
import { useThemeStore } from "@/stores/theme-store";
import { ThemeGrid } from "./ThemeGrid";
import { ImportTab } from "./ImportTab";
import { BrowseOnlineTab } from "./BrowseOnlineTab";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

function AppearanceDialog() {
    const open = useUIStore((s) => s.appearanceOpen);
    const setAppearanceOpen = useUIStore((s) => s.setAppearanceOpen);
    const fetchThemes = useThemeStore((s) => s.fetchThemes);

    useEffect(() => {
        if (open) {
            void fetchThemes();
        }
    }, [open, fetchThemes]);

    return (
        <Dialog open={open} onOpenChange={setAppearanceOpen}>
            <DialogContent className="max-w-2xl max-h-[80vh] overflow-hidden flex flex-col">
                <DialogHeader>
                    <DialogTitle>Appearance</DialogTitle>
                </DialogHeader>
                <Tabs defaultValue="themes" className="flex-1 overflow-hidden flex flex-col">
                    <TabsList className="w-fit">
                        <TabsTrigger value="themes">Themes</TabsTrigger>
                        <TabsTrigger value="import">Import</TabsTrigger>
                        <TabsTrigger value="browse">Browse Online</TabsTrigger>
                    </TabsList>
                    <TabsContent value="themes" className="flex-1 overflow-y-auto mt-4">
                        <ThemeGrid />
                    </TabsContent>
                    <TabsContent value="import" className="flex-1 overflow-y-auto mt-4">
                        <ImportTab />
                    </TabsContent>
                    <TabsContent value="browse" className="flex-1 overflow-y-auto mt-4">
                        <BrowseOnlineTab />
                    </TabsContent>
                </Tabs>
            </DialogContent>
        </Dialog>
    );
}
```

Export `AppearanceDialog`.

- [ ] **Step 2: Commit**

```bash
git add packages/ui/src/components/appearance/AppearanceDialog.tsx
git commit -m "feat: add AppearanceDialog with tabs"
```

### Task 21: Sidebar Button

**Files:**
- Modify: `packages/ui/src/components/sidebar/TaskSidebar.tsx:218-230`

- [ ] **Step 1: Add Appearance button next to Settings**

Import `Palette` from `lucide-react` and `toggleAppearance` from `useUIStore`.

In the sidebar footer div (`<div className="flex items-center justify-end px-1.5 py-1.5">`), add the Appearance button **before** the Settings button:

```tsx
<Button
    variant="ghost"
    size="icon-xs"
    onClick={toggleAppearance}
    aria-label="Appearance"
    tooltip="Appearance"
    tooltipSide="bottom"
    className="text-muted-foreground [-webkit-app-region:no-drag]"
>
    <Palette className="h-3.5 w-3.5" />
</Button>
```

- [ ] **Step 2: Commit**

```bash
git add packages/ui/src/components/sidebar/TaskSidebar.tsx
git commit -m "feat: add Appearance button to sidebar footer"
```

### Task 22: Verify Full Integration

- [ ] **Step 1: Run all backend tests**

Run: `cd packages/backend && bun test`
Expected: PASS

- [ ] **Step 2: Build and verify UI compiles**

Run: `cd packages/ui && bun run build`
Expected: Build succeeds

- [ ] **Step 3: Start the app and verify theme switching works**

Start the dev backend and UI, open the app, click the Appearance button, switch between themes, verify:
- CSS variables update (inspect `:root` in devtools)
- Terminal colors change
- Monaco editor colors change
- Theme persists after restart

- [ ] **Step 4: Commit any fixes**

```bash
git add -A
git commit -m "fix: integration fixes for theming system"
```

---

## Chunk 5: Terminal App Parsers

### Task 23: Alacritty Parser

**Files:**
- Create: `packages/backend/src/services/theme-parsers/alacritty.ts`
- Create: `packages/backend/tests/services/theme-parsers/alacritty.test.ts`

- [ ] **Step 1: Write failing tests**

Test parsing of Alacritty TOML format. Use a sample TOML string matching the format from terminalcolors.com (the Dracula example from earlier research).

- [ ] **Step 2: Run to verify failure**

Run: `cd packages/backend && bun test tests/services/theme-parsers/alacritty.test.ts`

- [ ] **Step 3: Implement parser**

Parse TOML manually (simple key-value + section headers — Alacritty theme TOMLs are simple enough to parse without a full TOML library) or add a lightweight TOML dependency. Extract `colors.primary.foreground`, `colors.primary.background`, `colors.normal.*`, `colors.bright.*`, `colors.selection.*`, `colors.cursor.*` into a `ThemeSource`.

Detect Alacritty by checking if `~/.config/alacritty/alacritty.toml` exists.

- [ ] **Step 4: Run tests to verify pass**

- [ ] **Step 5: Commit**

```bash
git add packages/backend/src/services/theme-parsers/alacritty.ts packages/backend/tests/services/theme-parsers/alacritty.test.ts
git commit -m "feat: add Alacritty theme parser"
```

### Task 24: Ghostty Parser

**Files:**
- Create: `packages/backend/src/services/theme-parsers/ghostty.ts`
- Create: `packages/backend/tests/services/theme-parsers/ghostty.test.ts`

- [ ] **Step 1: Write failing tests**

Test parsing of Ghostty config format: `background = #282a36`, `foreground = #f8f8f2`, `palette = 0=#21222c`, `palette = 1=#ff5555`, etc.

- [ ] **Step 2: Implement parser**

Simple line-by-line parsing. `palette = N=hex` maps to ANSI colors 0-15. `background`, `foreground`, `cursor-color`, `selection-background` are direct.

Detect by checking `~/.config/ghostty/config`.

- [ ] **Step 3: Run tests, commit**

```bash
git add packages/backend/src/services/theme-parsers/ghostty.ts packages/backend/tests/services/theme-parsers/ghostty.test.ts
git commit -m "feat: add Ghostty theme parser"
```

### Task 25: Kitty Parser

**Files:**
- Create: `packages/backend/src/services/theme-parsers/kitty.ts`
- Create: `packages/backend/tests/services/theme-parsers/kitty.test.ts`

- [ ] **Step 1: Write failing tests**

Test parsing of Kitty config: `foreground #f8f8f2`, `background #282a36`, `color0 #21222c`, `color1 #ff5555`, etc.

- [ ] **Step 2: Implement parser**

Line-by-line: `colorN hex` maps to ANSI colors 0-15. `foreground`, `background`, `cursor`, `selection_foreground`, `selection_background` are direct.

Detect by checking `~/.config/kitty/kitty.conf`.

- [ ] **Step 3: Run tests, commit**

```bash
git add packages/backend/src/services/theme-parsers/kitty.ts packages/backend/tests/services/theme-parsers/kitty.test.ts
git commit -m "feat: add Kitty theme parser"
```

### Task 26: Warp Parser

**Files:**
- Create: `packages/backend/src/services/theme-parsers/warp.ts`

- [ ] **Step 1: Implement parser**

Warp themes are YAML. Keys: `background`, `foreground`, `terminal_colors.normal.black`, etc. Use simple line parsing or a YAML library if one is already available.

Detect by scanning `~/.warp/themes/` for `.yaml` files.

- [ ] **Step 2: Commit**

```bash
git add packages/backend/src/services/theme-parsers/warp.ts
git commit -m "feat: add Warp theme parser"
```

### Task 27: iTerm2 Parser

**Files:**
- Create: `packages/backend/src/services/theme-parsers/iterm2.ts`

- [ ] **Step 1: Implement parser**

iTerm2 stores profiles in a plist. Colors are stored as components: `Ansi 0 Color` with sub-keys `Red Component`, `Green Component`, `Blue Component` as float 0-1. Convert float→int→hex.

The plist at `~/Library/Preferences/com.googlecode.iterm2.plist` may be binary — use `plutil -convert xml1 -o -` to convert, then parse XML.

- [ ] **Step 2: Commit**

```bash
git add packages/backend/src/services/theme-parsers/iterm2.ts
git commit -m "feat: add iTerm2 theme parser"
```

### Task 28: Terminal.app Parser (Best-Effort)

**Files:**
- Create: `packages/backend/src/services/theme-parsers/terminal-app.ts`

- [ ] **Step 1: Implement best-effort parser**

Terminal.app stores colors as NSKeyedArchiver data blobs in plist files. These are complex to decode. Implement a best-effort approach:
- Look for `.terminal` files in `~/Library/Preferences/` or common export locations
- Try to parse the plist XML and extract any color data that's in a recognizable format
- If decoding fails, skip gracefully

- [ ] **Step 2: Commit**

```bash
git add packages/backend/src/services/theme-parsers/terminal-app.ts
git commit -m "feat: add Terminal.app theme parser (best-effort)"
```

### Task 29: Parser Index & Integration

**Files:**
- Create: `packages/backend/src/services/theme-parsers/index.ts`
- Modify: `packages/backend/src/handlers/theme.ts`
- Modify: `packages/ui/src/components/appearance/ImportTab.tsx`

- [ ] **Step 1: Create parser index**

```typescript
// packages/backend/src/services/theme-parsers/index.ts
// Re-export all parser detect/parse functions

export { detectAlacritty, parseAlacritty } from "./alacritty";
export { detectGhostty, parseGhostty } from "./ghostty";
export { detectKitty, parseKitty } from "./kitty";
export { detectWarp, parseWarp } from "./warp";
export { detectIterm2, parseIterm2 } from "./iterm2";
export { detectTerminalApp, parseTerminalApp } from "./terminal-app";
```

- [ ] **Step 2: Add import detection to ThemeService and theme handler**

Add a method to `ThemeService` that runs all detectors and returns which apps have importable themes:

```typescript
async detectTerminalApps(): Promise<Array<{ app: string; themes: ThemeSource[] }>> {
    // Call each detector, return results
}
```

Register `MSG.THEME_IMPORT_SCAN` in `packages/backend/src/handlers/theme.ts` and return:

```typescript
const apps = await themeService.detectTerminalApps();
return { apps } satisfies ThemeImportScanResponse;
```

Do not overload `THEME_IMPORT`, which remains the write/import action.

- [ ] **Step 3: Update ImportTab with real UI**

Replace placeholder with actual terminal app detection results, import buttons, and a "From File..." option.

- [ ] **Step 4: Commit**

```bash
git add packages/backend/src/services/theme-parsers/ packages/ui/src/components/appearance/ImportTab.tsx
git commit -m "feat: integrate terminal app parsers into import flow"
```

---

## Chunk 6: Online Theme Browsing (terminalcolors.com)

### Task 30: Backend Browse + Download Endpoints

The backend contract for online browsing has two parts:
- `THEME_BROWSE_LIST` returns a curated or scraped list of online themes with stable ids and download URLs.
- `THEME_DOWNLOAD` downloads the Alacritty TOML, parses it, saves it under the provided id, and returns the refreshed installed theme list.

- [ ] **Step 1: Test the download handler manually**

Start the backend, send a `THEME_BROWSE_LIST` request and verify it returns online theme metadata. Then send a `THEME_DOWNLOAD` request with `id: "dracula-default", url: "https://terminalcolors.com/downloads/alacritty/dracula-default.toml"`, verify it installs the parsed theme and returns the updated local theme list.

- [ ] **Step 2: Commit any fixes**

### Task 31: BrowseOnlineTab Implementation

**Files:**
- Modify: `packages/ui/src/components/appearance/BrowseOnlineTab.tsx`

- [ ] **Step 1: Implement the browse UI**

The component needs to:
1. Fetch the theme list via `MSG.THEME_BROWSE_LIST`
2. Display a grid of theme cards with preview swatches
3. On click, send `MSG.THEME_DOWNLOAD` with the selected online theme id and download URL, then refresh the installed theme store from the returned list

This requires understanding the terminalcolors.com page structure to extract theme names and download URLs. The approach:
- Backend owns discovery: either scrape `https://terminalcolors.com/` or expose a curated fallback list when scraping is brittle
- UI only consumes the backend response and never fetches terminalcolors.com directly

Implementation details will depend on the actual page structure at build time. Maintain a curated fallback list of popular themes with stable ids so the UI contract does not change if scraping fails.

- [ ] **Step 2: Commit**

```bash
git add packages/ui/src/components/appearance/BrowseOnlineTab.tsx
git commit -m "feat: implement online theme browser"
```

### Task 32: Final Integration Test

- [ ] **Step 1: Run all backend tests**

Run: `cd packages/backend && bun test`
Expected: All PASS

- [ ] **Step 2: Run all shared tests**

Run: `cd packages/shared && bun test`
Expected: All PASS

- [ ] **Step 3: Build UI**

Run: `cd packages/ui && bun run build`
Expected: Build succeeds

- [ ] **Step 4: Manual smoke test**

Verify end-to-end:
- App starts with Catppuccin Mocha (default)
- Opening Appearance dialog shows all bundled themes
- Clicking a theme immediately changes app colors
- Terminal colors update
- Monaco editor colors update
- Theme persists after app restart
- Import tab shows detected terminal apps (if any installed)
- Custom theme files in `~/.config/taskflow/themes/` appear in the grid
