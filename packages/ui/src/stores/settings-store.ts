import { create } from "zustand";
import type { AppSettings, SettingsUpdatePayload } from "@taskflow/shared";
import { MSG } from "@taskflow/shared";
import { sendRequest } from "../hooks/useWebSocket";
import { useUIStore } from "./ui-store";
import { useMarkdownInputStore } from "./markdown-input-store";

interface DataDirInfo {
    dataDir: string;
    baseDir: string;
    isDefault: boolean;
    conflict?: boolean;
}

interface SettingsStore {
    settings: AppSettings | null;
    dataDirInfo: DataDirInfo | null;
    fetchSettings(): Promise<void>;
    updateSettings(partial: SettingsUpdatePayload): Promise<void>;
    fetchDataDir(): Promise<void>;
    updateDataDir(path: string, mode?: "overwrite" | "adopt"): Promise<DataDirInfo>;
}

export const useSettingsStore = create<SettingsStore>((set) => ({
    settings: null,
    dataDirInfo: null,
    async fetchSettings() {
        const settings = await sendRequest<AppSettings>(MSG.SETTINGS_GET);
        set({ settings });
        if (settings.layout?.panels) {
            useUIStore.getState().hydrateLayout(settings.layout.panels);
            useMarkdownInputStore.getState().hydrateLayout(
                settings.layout.panels.markdownEditorPosition,
                settings.layout.panels.markdownEditorSize,
            );
        }
        window.taskflow?.sendCompactSidebarState(settings.layout?.panels?.compactSidebar ?? false);
    },
    async updateSettings(partial) {
        const settings = await sendRequest<AppSettings>(MSG.SETTINGS_UPDATE, partial);
        set({ settings });
    },
    async fetchDataDir() {
        const dataDirInfo = await sendRequest<DataDirInfo>(MSG.SETTINGS_GET_DATA_DIR);
        set({ dataDirInfo });
    },
    async updateDataDir(path: string, mode?: "overwrite" | "adopt") {
        const dataDirInfo = await sendRequest<DataDirInfo>(MSG.SETTINGS_UPDATE_DATA_DIR, {
            path,
            mode,
        });
        if (!dataDirInfo.conflict) {
            set({ dataDirInfo });
        }
        return dataDirInfo;
    },
}));
