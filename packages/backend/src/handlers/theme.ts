import { MSG } from "@taskflow/shared";
import type {
    ThemeColors,
    ThemeDeletePayload,
    ThemeSource,
    ThemeImportResponse,
    ThemeImportPayload,
    ThemeImportFilePayload,
    ThemeImportScanResponse,
    ThemeListResponse,
    ThemeBrowseListResponse,
    ThemeDownloadPayload,
    ThemeDownloadResponse,
} from "@taskflow/shared";
import type { Router } from "../ws/router";
import type { ThemeService } from "../services/theme-service";
import { parseAlacrittyToml } from "../services/theme-parsers/alacritty";

// Curated list of popular themes from terminalcolors.com.
// Each entry has a backend-owned stable id, preview colors for the UI,
// and a direct Alacritty TOML download URL.
const ONLINE_CATALOG: Array<{
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

export function registerThemeHandlers(router: Router, themeService: ThemeService): void {
    router.register(MSG.THEMES_LIST, async () => {
        const themes = await themeService.listAll();
        return { themes } satisfies ThemeListResponse;
    });

    router.register(MSG.THEME_IMPORT, async (payload) => {
        const theme = (payload as ThemeImportPayload | null | undefined)?.theme;
        const record = await themeService.save(theme as ThemeSource);
        const themes = await themeService.listAll();
        return { themes, importedThemeId: record.id } satisfies ThemeImportResponse;
    });

    router.register(MSG.THEME_IMPORT_SCAN, async () => {
        const apps = await themeService.detectTerminalApps();
        return { apps } satisfies ThemeImportScanResponse;
    });

    router.register(MSG.THEME_IMPORT_FILE, async (payload) => {
        const path = (payload as ThemeImportFilePayload | null | undefined)?.path;
        if (typeof path !== "string") {
            throw new Error("Invalid file path");
        }
        const record = await themeService.importFromFile(path);
        const themes = await themeService.listAll();
        return { themes, importedThemeId: record.id } satisfies ThemeImportResponse;
    });

    router.register(MSG.THEME_DELETE, async (payload) => {
        const id = (payload as ThemeDeletePayload | null | undefined)?.id;
        if (typeof id !== "string") {
            throw new Error("Invalid theme id");
        }
        await themeService.delete(id);
        const themes = await themeService.listAll();
        return { themes } satisfies ThemeListResponse;
    });

    router.register(MSG.THEME_BROWSE_LIST, async () => {
        const installed = await themeService.listAll();
        const installedIds = new Set(installed.map((t) => t.id));
        const themes = ONLINE_CATALOG.map((t) => ({
            ...t,
            installed: installedIds.has(t.id),
            installedThemeId: installedIds.has(t.id) ? t.id : undefined,
        }));
        return { themes } satisfies ThemeBrowseListResponse;
    });

    router.register(MSG.THEME_DOWNLOAD, async (payload) => {
        const { id, url, name } = payload as ThemeDownloadPayload;
        if (typeof url !== "string" || typeof name !== "string" || typeof id !== "string") {
            throw new Error("Invalid download payload");
        }
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`Failed to download theme: ${response.status}`);
        }
        const toml = await response.text();
        const parsed = parseAlacrittyToml(toml, name);
        if (!parsed) {
            throw new Error("Failed to parse downloaded theme");
        }
        const theme: ThemeSource = { ...parsed, origin: "online" };
        const record = await themeService.save(theme, id, { overwriteExisting: true });
        const themes = await themeService.listAll();
        return { themes, importedThemeId: record.id } satisfies ThemeDownloadResponse;
    });
}
