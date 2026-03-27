import { useEffect, useRef, type RefObject } from "react";
import type { Terminal } from "@xterm/xterm";
import { useUIStore } from "@/stores/ui-store";
import { useMarkdownInputStore, getEditor } from "@/stores/markdown-input-store";

/**
 * Blurs the xterm textarea while Cmd+Shift is held so that modifier key
 * events bubble up to the window (xterm swallows them otherwise).
 *
 * On modifier release, restores focus to the terminal — unless:
 *  - The panel navigated away from workspace during Cmd+Shift cycling
 *  - The markdown input editor is open (it should keep focus)
 *  - Navigation mode just ended (usePanelActivation handles that case)
 */
function useTerminalModifierBlur(
    containerRef: RefObject<HTMLDivElement | null>,
    termRef: RefObject<Terminal | null>,
    sessionId: string,
    visible: boolean,
) {
    const restoreRef = useRef(false);

    useEffect(() => {
        if (!visible) return;

        const handleKeyDown = (event: KeyboardEvent) => {
            if (!(event.metaKey || event.ctrlKey) || !event.shiftKey) return;

            // ⌘⇧E — skip blur so the xterm input handler can toggle
            // the markdown input helper (it handles this via
            // attachCustomKeyEventHandler).
            if (event.code === "KeyE") return;

            const container = containerRef.current;
            const active = document.activeElement;
            if (!container || !(active instanceof HTMLElement) || !container.contains(active)) {
                return;
            }

            restoreRef.current = true;
            active.blur();
        };

        const handleKeyUp = (event: KeyboardEvent) => {
            if (!restoreRef.current) return;

            if (event.key === "Shift" || event.key === "Meta" || event.key === "Control") {
                const allReleased = !event.metaKey && !event.ctrlKey && !event.shiftKey;
                const shiftReleased = event.key === "Shift";

                if (allReleased || shiftReleased) {
                    restoreRef.current = false;

                    // Don't restore if panel navigated away from workspace
                    if (useUIStore.getState().focusedPanel !== "workspace") return;

                    // Don't restore if markdown editor is open
                    const editorOpen = getEditor(
                        useMarkdownInputStore.getState(),
                        sessionId,
                    ).isOpen;
                    if (editorOpen) return;

                    termRef.current?.focus();
                }
            }
        };

        const handleBlur = () => {
            restoreRef.current = false;
        };

        window.addEventListener("keydown", handleKeyDown, true);
        window.addEventListener("keyup", handleKeyUp, true);
        window.addEventListener("blur", handleBlur);

        return () => {
            window.removeEventListener("keydown", handleKeyDown, true);
            window.removeEventListener("keyup", handleKeyUp, true);
            window.removeEventListener("blur", handleBlur);
        };
    }, [containerRef, termRef, visible, sessionId]);
}

export { useTerminalModifierBlur };
