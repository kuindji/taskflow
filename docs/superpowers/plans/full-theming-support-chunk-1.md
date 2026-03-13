# Chunk 1: Foundation — Types, Constants, Color Utilities, Derivation Engine

> **Overview:** `full-theming-support-overview.md` | **Spec:** `docs/superpowers/specs/2026-03-13-full-theming-support-design.md`

---

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

- [ ] **Step 1: Update AppSettings and SettingsUpdatePayload**

In `packages/shared/src/types/settings.ts`, add the `appearance` section inline (matching the pattern of other sections like `general`, `terminal`, `editor` — they are all inline, not separate named interfaces):

Add to `AppSettings` interface:
```typescript
appearance: {
    theme: string;
};
```

Add to `SettingsUpdatePayload` interface:
```typescript
appearance?: {
    theme?: string;
};
```

`appearance.theme` stores the canonical theme id/slug (for example `catppuccin-mocha`), not the display name. Do **not** export a separate `AppearanceSettings` interface — it's only used here.

- [ ] **Step 2: Add theme messages and default to constants**

In `packages/shared/src/constants.ts`, add to `MSG` object:

```typescript
    // Themes
    THEMES_LIST: "theme:list",
    THEME_IMPORT_SCAN: "theme:import-scan",
    THEME_IMPORT: "theme:import",
    THEME_IMPORT_FILE: "theme:import-file",
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

export interface ThemeImportFilePayload {
    path: string;
}

export interface ThemeImportResponse {
    themes: ThemeRecord[];
    importedThemeId: string;
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
    preview: ThemeColors;
    installed: boolean;
    installedThemeId?: string;
}

export interface ThemeBrowseListResponse {
    themes: OnlineThemeRecord[];
}

export interface ThemeDownloadPayload {
    id: string;
    url: string;
    name: string;
}

export interface ThemeDownloadResponse {
    themes: ThemeRecord[];
    importedThemeId: string;
}
```

`OnlineThemeRecord.preview` gives the Browse Online tab enough color data to render preview swatches without making the renderer scrape or fetch terminalcolors.com directly. `ThemeDownloadResponse.importedThemeId` is the actual installed canonical id returned by the backend after collision rules are applied.

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

Create the remaining 5 theme files with these exact colors (sourced from each project's official repos):

**Dracula** (`dracula.json`):
```json
{
    "version": 1,
    "name": "Dracula",
    "author": "Dracula Theme",
    "origin": "bundled",
    "colors": {
        "foreground": "#f8f8f2",
        "background": "#282a36",
        "cursor": "#f8f8f2",
        "cursorText": "#282a36",
        "selection": "#44475a",
        "selectionText": "#f8f8f2",
        "ansi": {
            "black": "#21222c",
            "red": "#ff5555",
            "green": "#50fa7b",
            "yellow": "#f1fa8c",
            "blue": "#bd93f9",
            "magenta": "#ff79c6",
            "cyan": "#8be9fd",
            "white": "#f8f8f2",
            "brightBlack": "#6272a4",
            "brightRed": "#ff6e6e",
            "brightGreen": "#69ff94",
            "brightYellow": "#ffffa5",
            "brightBlue": "#d6acff",
            "brightMagenta": "#ff92df",
            "brightCyan": "#a4ffff",
            "brightWhite": "#ffffff"
        }
    }
}
```

**Nord** (`nord.json`):
```json
{
    "version": 1,
    "name": "Nord",
    "author": "Arctic Ice Studio",
    "origin": "bundled",
    "colors": {
        "foreground": "#d8dee9",
        "background": "#2e3440",
        "cursor": "#d8dee9",
        "cursorText": "#2e3440",
        "selection": "#434c5e",
        "selectionText": "#d8dee9",
        "ansi": {
            "black": "#3b4252",
            "red": "#bf616a",
            "green": "#a3be8c",
            "yellow": "#ebcb8b",
            "blue": "#81a1c1",
            "magenta": "#b48ead",
            "cyan": "#88c0d0",
            "white": "#e5e9f0",
            "brightBlack": "#4c566a",
            "brightRed": "#bf616a",
            "brightGreen": "#a3be8c",
            "brightYellow": "#ebcb8b",
            "brightBlue": "#81a1c1",
            "brightMagenta": "#b48ead",
            "brightCyan": "#8fbcbb",
            "brightWhite": "#eceff4"
        }
    }
}
```

**Gruvbox Dark** (`gruvbox-dark.json`):
```json
{
    "version": 1,
    "name": "Gruvbox Dark",
    "author": "morhetz",
    "origin": "bundled",
    "colors": {
        "foreground": "#ebdbb2",
        "background": "#282828",
        "cursor": "#ebdbb2",
        "cursorText": "#282828",
        "selection": "#504945",
        "selectionText": "#ebdbb2",
        "ansi": {
            "black": "#282828",
            "red": "#cc241d",
            "green": "#98971a",
            "yellow": "#d79921",
            "blue": "#458588",
            "magenta": "#b16286",
            "cyan": "#689d6a",
            "white": "#a89984",
            "brightBlack": "#928374",
            "brightRed": "#fb4934",
            "brightGreen": "#b8bb26",
            "brightYellow": "#fabd2f",
            "brightBlue": "#83a598",
            "brightMagenta": "#d3869b",
            "brightCyan": "#8ec07c",
            "brightWhite": "#ebdbb2"
        }
    }
}
```

**Tokyo Night** (`tokyo-night.json`):
```json
{
    "version": 1,
    "name": "Tokyo Night",
    "author": "enkia",
    "origin": "bundled",
    "colors": {
        "foreground": "#a9b1d6",
        "background": "#1a1b26",
        "cursor": "#c0caf5",
        "cursorText": "#1a1b26",
        "selection": "#33467c",
        "selectionText": "#a9b1d6",
        "ansi": {
            "black": "#15161e",
            "red": "#f7768e",
            "green": "#9ece6a",
            "yellow": "#e0af68",
            "blue": "#7aa2f7",
            "magenta": "#bb9af7",
            "cyan": "#7dcfff",
            "white": "#a9b1d6",
            "brightBlack": "#414868",
            "brightRed": "#f7768e",
            "brightGreen": "#9ece6a",
            "brightYellow": "#e0af68",
            "brightBlue": "#7aa2f7",
            "brightMagenta": "#bb9af7",
            "brightCyan": "#7dcfff",
            "brightWhite": "#c0caf5"
        }
    }
}
```

**Solarized Dark** (`solarized-dark.json`):
```json
{
    "version": 1,
    "name": "Solarized Dark",
    "author": "Ethan Schoonover",
    "origin": "bundled",
    "colors": {
        "foreground": "#839496",
        "background": "#002b36",
        "cursor": "#839496",
        "cursorText": "#002b36",
        "selection": "#073642",
        "selectionText": "#839496",
        "ansi": {
            "black": "#073642",
            "red": "#dc322f",
            "green": "#859900",
            "yellow": "#b58900",
            "blue": "#268bd2",
            "magenta": "#d33682",
            "cyan": "#2aa198",
            "white": "#eee8d5",
            "brightBlack": "#586e75",
            "brightRed": "#cb4b16",
            "brightGreen": "#586e75",
            "brightYellow": "#657b83",
            "brightBlue": "#839496",
            "brightMagenta": "#6c71c4",
            "brightCyan": "#93a1a1",
            "brightWhite": "#fdf6e3"
        }
    }
}
```

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
