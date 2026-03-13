# Chunk 6: Online Theme Browsing (terminalcolors.com)

> **Overview:** `full-theming-support-overview.md` | **Spec:** `docs/superpowers/specs/2026-03-13-full-theming-support-design.md`

---

### Task 30: Backend Browse + Download Handlers

**Files:**
- Modify: `packages/backend/src/handlers/theme.ts`

The browse/download handlers are registered here (not in Chunk 2) because they depend on the Alacritty parser from Chunk 5.

- [ ] **Step 1: Add THEME_BROWSE_LIST and THEME_DOWNLOAD handlers**

Add imports to `packages/backend/src/handlers/theme.ts`:
```typescript
import type {
    ThemeBrowseListResponse,
    ThemeDownloadPayload,
    ThemeDownloadResponse,
    ThemeSource,
} from "@taskflow/shared";
```

Add these handler registrations inside `registerThemeHandlers()`:

```typescript
    router.register(MSG.THEME_BROWSE_LIST, async () => {
        // Curated list of popular themes from terminalcolors.com.
        // Each entry has a backend-owned stable id, preview colors for the UI,
        // and a direct Alacritty TOML download URL.
        const catalog: Array<{
            id: string;
            name: string;
            author?: string;
            downloadUrl: string;
            preview: ThemeColors;
        }> = [
            {
                id: "terminalcolors-one-dark",
                name: "One Dark",
                author: "Atom",
                downloadUrl: "https://terminalcolors.com/downloads/alacritty/one-dark.toml",
                preview: {
                    foreground: "#abb2bf",
                    background: "#282c34",
                    cursor: "#528bff",
                    cursorText: "#282c34",
                    selection: "#3e4451",
                    selectionText: "#abb2bf",
                    ansi: {
                        black: "#282c34", red: "#e06c75", green: "#98c379",
                        yellow: "#e5c07b", blue: "#61afef", magenta: "#c678dd",
                        cyan: "#56b6c2", white: "#abb2bf",
                        brightBlack: "#545862", brightRed: "#e06c75",
                        brightGreen: "#98c379", brightYellow: "#e5c07b",
                        brightBlue: "#61afef", brightMagenta: "#c678dd",
                        brightCyan: "#56b6c2", brightWhite: "#c8ccd4",
                    },
                },
            },
            {
                id: "terminalcolors-rose-pine",
                name: "Rosé Pine",
                author: "Rosé Pine",
                downloadUrl: "https://terminalcolors.com/downloads/alacritty/rose-pine.toml",
                preview: {
                    foreground: "#e0def4",
                    background: "#191724",
                    cursor: "#524f67",
                    cursorText: "#e0def4",
                    selection: "#2a283e",
                    selectionText: "#e0def4",
                    ansi: {
                        black: "#26233a", red: "#eb6f92", green: "#31748f",
                        yellow: "#f6c177", blue: "#9ccfd8", magenta: "#c4a7e7",
                        cyan: "#ebbcba", white: "#e0def4",
                        brightBlack: "#6e6a86", brightRed: "#eb6f92",
                        brightGreen: "#31748f", brightYellow: "#f6c177",
                        brightBlue: "#9ccfd8", brightMagenta: "#c4a7e7",
                        brightCyan: "#ebbcba", brightWhite: "#e0def4",
                    },
                },
            },
            {
                id: "terminalcolors-kanagawa",
                name: "Kanagawa",
                author: "rebelot",
                downloadUrl: "https://terminalcolors.com/downloads/alacritty/kanagawa.toml",
                preview: {
                    foreground: "#dcd7ba",
                    background: "#1f1f28",
                    cursor: "#c8c093",
                    cursorText: "#1f1f28",
                    selection: "#2d4f67",
                    selectionText: "#dcd7ba",
                    ansi: {
                        black: "#090618", red: "#c34043", green: "#76946a",
                        yellow: "#c0a36e", blue: "#7e9cd8", magenta: "#957fb8",
                        cyan: "#6a9589", white: "#c8c093",
                        brightBlack: "#727169", brightRed: "#e82424",
                        brightGreen: "#98bb6c", brightYellow: "#e6c384",
                        brightBlue: "#7fb4ca", brightMagenta: "#938aa9",
                        brightCyan: "#7aa89f", brightWhite: "#dcd7ba",
                    },
                },
            },
            {
                id: "terminalcolors-everforest",
                name: "Everforest Dark",
                author: "sainnhe",
                downloadUrl: "https://terminalcolors.com/downloads/alacritty/everforest-dark.toml",
                preview: {
                    foreground: "#d3c6aa",
                    background: "#2d353b",
                    cursor: "#d3c6aa",
                    cursorText: "#2d353b",
                    selection: "#475258",
                    selectionText: "#d3c6aa",
                    ansi: {
                        black: "#475258", red: "#e67e80", green: "#a7c080",
                        yellow: "#dbbc7f", blue: "#7fbbb3", magenta: "#d699b6",
                        cyan: "#83c092", white: "#d3c6aa",
                        brightBlack: "#475258", brightRed: "#e67e80",
                        brightGreen: "#a7c080", brightYellow: "#dbbc7f",
                        brightBlue: "#7fbbb3", brightMagenta: "#d699b6",
                        brightCyan: "#83c092", brightWhite: "#d3c6aa",
                    },
                },
            },
            {
                id: "terminalcolors-moonfly",
                name: "Moonfly",
                author: "bluz71",
                downloadUrl: "https://terminalcolors.com/downloads/alacritty/moonfly.toml",
                preview: {
                    foreground: "#bdbddb",
                    background: "#080808",
                    cursor: "#9e9e9e",
                    cursorText: "#080808",
                    selection: "#b2ceee",
                    selectionText: "#080808",
                    ansi: {
                        black: "#323437", red: "#ff5454", green: "#8cc85f",
                        yellow: "#e3c78a", blue: "#80a0ff", magenta: "#cf87e8",
                        cyan: "#79dac8", white: "#c6c6c6",
                        brightBlack: "#949494", brightRed: "#ff5189",
                        brightGreen: "#36c692", brightYellow: "#c6c684",
                        brightBlue: "#74b2ff", brightMagenta: "#ae81ff",
                        brightCyan: "#85dc85", brightWhite: "#e4e4e4",
                    },
                },
            },
        ];

        // Mark which online themes are already installed locally
        const installed = await themeService.listAll();
        const installedIds = new Set(installed.map((t) => t.id));
        const themes = catalog.map((t) => ({
            ...t,
            installed: installedIds.has(t.id),
            installedThemeId: installedIds.has(t.id) ? t.id : undefined,
        }));

        return { themes } satisfies ThemeBrowseListResponse;
    });

    router.register(MSG.THEME_DOWNLOAD, async (payload) => {
        const { id, url, name } = payload as ThemeDownloadPayload;
        const response = await fetch(url);
        const toml = await response.text();
        const { parseAlacrittyToml } = await import("../services/theme-parsers/alacritty");
        const parsed = parseAlacrittyToml(toml, name);
        const theme: ThemeSource = { ...parsed, origin: "online" };
        const record = await themeService.save(theme, id, { overwriteExisting: true });
        const themes = await themeService.listAll();
        return { themes, importedThemeId: record.id } satisfies ThemeDownloadResponse;
    });
```

- [ ] **Step 2: Run backend and test manually**

Start the backend, send a `THEME_BROWSE_LIST` request and verify it returns online theme metadata including preview colors. Then send a `THEME_DOWNLOAD` request with `id: "terminalcolors-one-dark", url: "https://terminalcolors.com/downloads/alacritty/one-dark.toml"`, verify it installs the parsed theme and returns the updated local theme list plus `importedThemeId`.

- [ ] **Step 3: Commit**

```bash
git add packages/backend/src/handlers/theme.ts
git commit -m "feat: add online browse and download theme handlers"
```

### Task 31: BrowseOnlineTab Implementation

**Files:**
- Modify: `packages/ui/src/components/appearance/BrowseOnlineTab.tsx`

- [ ] **Step 1: Implement the browse UI**

The component needs to:
1. Fetch the theme list via `MSG.THEME_BROWSE_LIST`
2. Display a grid of theme cards with preview swatches
3. On click, call `useThemeStore((s) => s.downloadOnlineTheme)` so the backend response can update the installed list and activate the returned `importedThemeId`

This requires understanding the terminalcolors.com page structure to extract theme names, download URLs, and preview colors. The approach:
- Backend owns discovery: either scrape `https://terminalcolors.com/` or expose a curated fallback list when scraping is brittle
- UI only consumes the backend response and never fetches terminalcolors.com directly

Implementation details will depend on the actual page structure at build time. Maintain a curated fallback list of popular themes with stable backend-owned ids such as `terminalcolors-one-dark` so bundled theme ids remain reserved and the UI contract does not change if scraping fails.

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
