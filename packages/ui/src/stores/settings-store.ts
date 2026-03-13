import { create } from "zustand";
import type { AppSettings, SettingsUpdatePayload } from "@taskflow/shared";
import { MSG } from "@taskflow/shared";
import { sendRequest } from "../hooks/useWebSocket";
import { useUIStore } from "./ui-store";

interface SettingsStore {
    settings: AppSettings | null;
    fetchSettings(): Promise<void>;
    updateSettings(partial: SettingsUpdatePayload): Promise<void>;
}

export const useSettingsStore = create<SettingsStore>((set) => ({
    settings: null,
    async fetchSettings() {
        const settings = await sendRequest<AppSettings>(MSG.SETTINGS_GET);
        set({ settings });
        if (settings.layout?.panels) {
            useUIStore.getState().hydrateLayout(settings.layout.panels);
        }
        window.taskflow?.sendCompactSidebarState(settings.layout?.panels?.compactSidebar ?? false);
    },
    async updateSettings(partial) {
        const settings = await sendRequest<AppSettings>(MSG.SETTINGS_UPDATE, partial);
        set({ settings });
    },
}));
