import { useUIStore } from "@/stores/ui-store";
import { useSettingsStore } from "@/stores/settings-store";

/**
 * Write the rail's collapsed state and width back to settings. `AppShell`'s
 * single `handleResizeEnd` covers the shell panels, but the rail lives inside a
 * pane, so it persists itself — from both the toolbar toggle and the drag.
 */
function persistWikiRail(): void {
    const { wikiRailOpen, wikiRailWidth } = useUIStore.getState();
    void useSettingsStore.getState().updateSettings({
        layout: { panels: { wikiRailOpen, wikiRailWidth } },
    });
}

export { persistWikiRail };
