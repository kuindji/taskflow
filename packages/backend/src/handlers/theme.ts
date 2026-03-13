import { MSG } from "@taskflow/shared";
import type {
    ThemeDeletePayload,
    ThemeImportResponse,
    ThemeImportPayload,
    ThemeListResponse,
} from "@taskflow/shared";
import type { Router } from "../ws/router";
import type { ThemeService } from "../services/theme-service";

export function registerThemeHandlers(router: Router, themeService: ThemeService): void {
    router.register(MSG.THEMES_LIST, async () => {
        const themes = await themeService.listAll();
        return { themes } satisfies ThemeListResponse;
    });

    router.register(MSG.THEME_IMPORT, async (payload) => {
        const { theme } = payload as ThemeImportPayload;
        const record = await themeService.save(theme);
        const themes = await themeService.listAll();
        return { themes, importedThemeId: record.id } satisfies ThemeImportResponse;
    });

    router.register(MSG.THEME_DELETE, async (payload) => {
        const { id } = payload as ThemeDeletePayload;
        await themeService.delete(id);
        const themes = await themeService.listAll();
        return { themes } satisfies ThemeListResponse;
    });

    // NOTE: THEME_BROWSE_LIST and THEME_DOWNLOAD handlers are registered in Chunk 6
    // after the Alacritty parser is available from Chunk 5.
}
