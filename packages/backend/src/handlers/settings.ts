import { MSG } from "@taskflow/shared";
import type { SettingsUpdatePayload } from "@taskflow/shared";
import type { Router } from "../ws/router";
import type { SettingsStore } from "../services/settings-store";

export function registerSettingsHandlers(router: Router, settingsStore: SettingsStore): void {
    router.register(MSG.SETTINGS_GET, async () => {
        return settingsStore.get();
    });

    router.register(MSG.SETTINGS_UPDATE, async (payload) => {
        const update = payload as SettingsUpdatePayload;
        return settingsStore.update(update);
    });
}
