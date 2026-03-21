import { useState, useEffect } from "react";
import { isDialogOpen, isEditableElement } from "@/lib/global-shortcuts";

export function useCmdHeld() {
    const [cmdHeld, setCmdHeld] = useState(false);
    const [shiftHeld, setShiftHeld] = useState(false);
    const [dialogOpen, setDialogOpen] = useState(() => isDialogOpen());

    useEffect(() => {
        // Use e.metaKey / e.shiftKey flags on every key event rather than
        // tracking individual "Meta" / "Shift" key names.  This is more
        // reliable because Electron menu accelerators can consume modifier
        // keydown events before they reach the renderer.
        const syncDialogOpen = () => {
            setDialogOpen(isDialogOpen());
        };
        const onKeyDown = (e: KeyboardEvent) => {
            syncDialogOpen();
            setCmdHeld(e.metaKey);
            setShiftHeld(e.shiftKey);
        };
        const onKeyUp = (e: KeyboardEvent) => {
            syncDialogOpen();
            setCmdHeld(e.metaKey);
            setShiftHeld(e.shiftKey);
        };
        const onBlur = () => {
            setCmdHeld(false);
            setShiftHeld(false);
            syncDialogOpen();
        };
        const observer = new MutationObserver(() => {
            syncDialogOpen();
        });

        syncDialogOpen();
        window.addEventListener("keydown", onKeyDown);
        window.addEventListener("keyup", onKeyUp);
        window.addEventListener("blur", onBlur);
        observer.observe(document.body, { childList: true, subtree: true });
        return () => {
            window.removeEventListener("keydown", onKeyDown);
            window.removeEventListener("keyup", onKeyUp);
            window.removeEventListener("blur", onBlur);
            observer.disconnect();
        };
    }, []);

    return {
        cmdHeld: cmdHeld && !dialogOpen,
        cmdShiftHeld:
            cmdHeld && shiftHeld && !dialogOpen && !isEditableElement(document.activeElement),
    };
}
