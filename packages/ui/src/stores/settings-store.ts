import { create } from "zustand";
import type { AppSettings, SettingsUpdatePayload, SettingsUpdatedEvent } from "@taskflow/shared";
import { MSG } from "@taskflow/shared";
import { getPrimary, onEvent, sendRequest } from "@/lib/connection-registry";
import { registerBackendReset } from "./store-reset";
import { useUIStore } from "./ui-store";
import { useMarkdownInputStore } from "./markdown-input-store";

interface DataDirInfo {
    dataDir: string;
    baseDir: string;
    isDefault: boolean;
    conflict?: boolean;
}

interface SettingsStore {
    /** Every attached machine's settings. Read-only except for primary's. */
    byBackend: Record<string, AppSettings>;
    /**
     * Primary's settings: what this app's own surfaces (fonts, layout, editor)
     * follow. A launch payload for another machine reads `settingsFor` instead.
     */
    settings: AppSettings | null;
    dataDirInfo: DataDirInfo | null;
    fetchSettings(backendId: string): Promise<void>;
    /** Only ever sent to primary, which it resolves itself. */
    updateSettings(partial: SettingsUpdatePayload): Promise<void>;
    fetchDataDir(): Promise<void>;
    updateDataDir(path: string, mode?: "overwrite" | "adopt"): Promise<DataDirInfo>;
}

function primaryOrThrow(): string {
    const primary = getPrimary();
    if (!primary) throw new Error("Not connected to a backend");
    return primary;
}

function publish(byBackend: Record<string, AppSettings>): void {
    const primary = getPrimary();
    useSettingsStore.setState({
        byBackend,
        settings: primary ? (byBackend[primary] ?? null) : null,
    });
}

/** The machine's own settings, for a payload that machine will run; null until fetched. */
export function settingsFor(backendId: string): AppSettings | null {
    return useSettingsStore.getState().byBackend[backendId] ?? null;
}

export const useSettingsStore = create<SettingsStore>((set) => ({
    byBackend: {},
    settings: null,
    dataDirInfo: null,
    async fetchSettings(backendId) {
        const settings = await sendRequest<AppSettings>(backendId, MSG.SETTINGS_GET);
        publish({ ...useSettingsStore.getState().byBackend, [backendId]: settings });
        // Layout and window state are this app's, which only primary's settings drive.
        if (backendId !== getPrimary()) return;
        if (settings.layout?.panels) {
            useUIStore.getState().hydrateLayout(settings.layout.panels);
            useMarkdownInputStore
                .getState()
                .hydrateLayout(
                    settings.layout.panels.markdownEditorPosition,
                    settings.layout.panels.markdownEditorSize,
                );
        }
        window.taskflow?.sendCompactSidebarState(settings.layout?.panels?.compactSidebar ?? false);
        window.taskflow?.sendConfirmBeforeExitState(settings.general.confirmBeforeExit);
    },
    async updateSettings(partial) {
        const primary = primaryOrThrow();
        const settings = await sendRequest<AppSettings>(primary, MSG.SETTINGS_UPDATE, partial);
        publish({ ...useSettingsStore.getState().byBackend, [primary]: settings });
        if (partial.general && "confirmBeforeExit" in partial.general) {
            window.taskflow?.sendConfirmBeforeExitState(settings.general.confirmBeforeExit);
        }
    },
    async fetchDataDir() {
        const dataDirInfo = await sendRequest<DataDirInfo>(
            primaryOrThrow(),
            MSG.SETTINGS_GET_DATA_DIR,
        );
        set({ dataDirInfo });
    },
    async updateDataDir(path: string, mode?: "overwrite" | "adopt") {
        const dataDirInfo = await sendRequest<DataDirInfo>(
            primaryOrThrow(),
            MSG.SETTINGS_UPDATE_DATA_DIR,
            { path, mode },
        );
        if (!dataDirInfo.conflict) {
            set({ dataDirInfo });
        }
        return dataDirInfo;
    },
}));

registerBackendReset("settings-mirror", (backendId) => {
    const { [backendId]: _dropped, ...rest } = useSettingsStore.getState().byBackend;
    publish(rest);
});

// Another client saved: launch payloads read these defaults, so a stale copy
// would start agents with the old model. Layout stays this window's own.
const _unsubSettingsUpdated = onEvent(MSG.SETTINGS_UPDATED, (payload, backendId) => {
    const { settings } = payload as Partial<SettingsUpdatedEvent>;
    if (!settings) return;
    publish({ ...useSettingsStore.getState().byBackend, [backendId]: settings });
    if (backendId === getPrimary()) {
        window.taskflow?.sendConfirmBeforeExitState(settings.general.confirmBeforeExit);
    }
});

if (import.meta.hot) {
    import.meta.hot.dispose(() => {
        _unsubSettingsUpdated();
    });
}
