import { useEffect, useRef } from "react";
import { useUIStore, type PanelId } from "@/stores/ui-store";

/**
 * Calls `onActivate` when keyboard navigation mode ends (Shift released
 * from Cmd+Shift) while this panel is the focused panel.
 *
 * Each panel decides what "activation" means for it — e.g. the workspace
 * focuses the terminal, task-info focuses the first input field.
 */
function usePanelActivation(panelId: PanelId, onActivate: () => void) {
    const prevNavMode = useRef(false);
    const navigationMode = useUIStore((s) => s.navigationMode);
    const focusedPanel = useUIStore((s) => s.focusedPanel);

    useEffect(() => {
        if (prevNavMode.current && !navigationMode && focusedPanel === panelId) {
            onActivate();
        }
        prevNavMode.current = navigationMode;
    }, [navigationMode, focusedPanel, panelId, onActivate]);
}

export { usePanelActivation };
