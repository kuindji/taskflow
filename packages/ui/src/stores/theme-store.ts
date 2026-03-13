import { create } from "zustand";
import { MSG, DEFAULT_THEME_ID, bundledThemes, deriveTheme } from "@taskflow/shared";
import type {
    OnlineThemeRecord,
    ResolvedTheme,
    ThemeDownloadResponse,
    ThemeImportResponse,
    ThemeListResponse,
    ThemeRecord,
    ThemeSource,
} from "@taskflow/shared";
import { sendRequest } from "../hooks/useWebSocket";
import { useSettingsStore } from "./settings-store";

// Eagerly resolve the default bundled theme so `resolved` is never null.
// This ensures terminals and Monaco have a valid theme before settings load.
const defaultRecord = bundledThemes.find((t) => t.id === DEFAULT_THEME_ID) ?? bundledThemes[0];
const defaultResolved = deriveTheme(defaultRecord.source);

interface ThemeStore {
    themes: ThemeRecord[];
    activeThemeId: string;
    resolved: ResolvedTheme;
    fetchThemes(): Promise<void>;
    activateTheme(themeId: string): Promise<void>;
    importTheme(theme: ThemeSource): Promise<void>;
    importThemeFile(path: string): Promise<void>;
    downloadOnlineTheme(theme: OnlineThemeRecord): Promise<void>;
    deleteTheme(themeId: string): Promise<void>;
}

// Helper: given a response with themes + importedThemeId, update store and persist setting.
function applyImportResponse(
    set: (state: Partial<ThemeStore>) => void,
    response: { themes: ThemeRecord[]; importedThemeId: string },
): void {
    const record = response.themes.find((t) => t.id === response.importedThemeId);
    set(
        record
            ? {
                  themes: response.themes,
                  activeThemeId: record.id,
                  resolved: deriveTheme(record.source),
              }
            : { themes: response.themes },
    );
    if (record) {
        void useSettingsStore.getState().updateSettings({
            appearance: { theme: record.id },
        });
    }
}

export const useThemeStore = create<ThemeStore>((set, get) => ({
    themes: bundledThemes,
    activeThemeId: defaultRecord.id,
    resolved: defaultResolved,

    async fetchThemes() {
        try {
            const { themes } = await sendRequest<ThemeListResponse>(MSG.THEMES_LIST);

            // Prefer persisted settings when available, but preserve the live
            // selection across reconnects if settings are temporarily unavailable.
            const activeThemeId =
                useSettingsStore.getState().settings?.appearance?.theme ??
                get().activeThemeId ??
                DEFAULT_THEME_ID;
            const record =
                themes.find((t) => t.id === activeThemeId) ??
                themes.find((t) => t.id === DEFAULT_THEME_ID) ??
                themes[0];
            if (record) {
                set({
                    themes,
                    activeThemeId: record.id,
                    resolved: deriveTheme(record.source),
                });
            } else {
                set({ themes });
            }
        } catch {
            // Keep the eagerly resolved bundled default so startup and reconnects remain usable.
        }
    },

    async activateTheme(themeId: string) {
        const record = get().themes.find((t) => t.id === themeId);
        if (!record) return;
        set({
            activeThemeId: record.id,
            resolved: deriveTheme(record.source),
        });
        try {
            await useSettingsStore.getState().updateSettings({
                appearance: { theme: themeId },
            });
        } catch {
            // Theme is already applied visually; persistence will retry on next activation.
        }
    },

    async importTheme(theme: ThemeSource) {
        const response = await sendRequest<ThemeImportResponse>(MSG.THEME_IMPORT, { theme });
        applyImportResponse(set, response);
    },

    async importThemeFile(path: string) {
        const response = await sendRequest<ThemeImportResponse>(MSG.THEME_IMPORT_FILE, { path });
        applyImportResponse(set, response);
    },

    async downloadOnlineTheme(theme) {
        const response = await sendRequest<ThemeDownloadResponse>(MSG.THEME_DOWNLOAD, {
            id: theme.id,
            url: theme.downloadUrl,
            name: theme.name,
        });
        applyImportResponse(set, response);
    },

    async deleteTheme(themeId: string) {
        const deletingActive = themeId === get().activeThemeId;
        const { themes } = await sendRequest<ThemeListResponse>(MSG.THEME_DELETE, { id: themeId });
        const fallbackId = deletingActive ? DEFAULT_THEME_ID : get().activeThemeId;
        const record = themes.find((t) => t.id === fallbackId) ?? themes[0];

        if (record) {
            set({
                themes,
                activeThemeId: record.id,
                resolved: deriveTheme(record.source),
            });
        } else {
            set({ themes });
        }

        if (deletingActive && record) {
            await useSettingsStore.getState().updateSettings({
                appearance: { theme: record.id },
            });
        }
    },
}));
