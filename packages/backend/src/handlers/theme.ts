import { MSG } from "@taskflow/shared";
import type {
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
import { ONLINE_CATALOG } from "../services/online-theme-catalog";

function findInstalledOnlineThemeId(
    installedThemes: Awaited<ReturnType<ThemeService["listAll"]>>,
    catalogId: string,
): string | undefined {
    const exactMatch = installedThemes.find(
        (theme) => theme.id === catalogId && theme.source.origin === "online",
    );
    if (exactMatch) {
        return exactMatch.id;
    }

    return installedThemes.find(
        (theme) =>
            theme.source.origin === "online" &&
            theme.id.startsWith(`${catalogId}-`),
    )?.id;
}

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
        const themes = ONLINE_CATALOG.map((t) => ({
            ...t,
            installedThemeId: findInstalledOnlineThemeId(installed, t.id),
            installed: Boolean(findInstalledOnlineThemeId(installed, t.id)),
        }));
        return { themes } satisfies ThemeBrowseListResponse;
    });

    router.register(MSG.THEME_DOWNLOAD, async (payload) => {
        const { id, url, name } = payload as ThemeDownloadPayload;
        if (typeof url !== "string" || typeof name !== "string" || typeof id !== "string") {
            throw new Error("Invalid download payload");
        }
        // Validate URL against the curated catalog to prevent SSRF
        const catalogEntry = ONLINE_CATALOG.find((e) => e.id === id);
        if (!catalogEntry || catalogEntry.downloadUrl !== url) {
            throw new Error("Unknown or mismatched download URL");
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
        const installed = await themeService.listAll();
        const existingInstalledThemeId = findInstalledOnlineThemeId(installed, id);
        const record = await themeService.save(
            theme,
            existingInstalledThemeId ?? id,
            { overwriteExisting: true },
        );
        const themes = await themeService.listAll();
        return { themes, importedThemeId: record.id } satisfies ThemeDownloadResponse;
    });
}
