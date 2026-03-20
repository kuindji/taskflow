import { useState, useEffect } from "react";

export function useCmdHeld() {
    const [cmdHeld, setCmdHeld] = useState(false);
    const [shiftHeld, setShiftHeld] = useState(false);

    useEffect(() => {
        // Use e.metaKey / e.shiftKey flags on every key event rather than
        // tracking individual "Meta" / "Shift" key names.  This is more
        // reliable because Electron menu accelerators can consume modifier
        // keydown events before they reach the renderer.
        const onKeyDown = (e: KeyboardEvent) => {
            setCmdHeld(e.metaKey);
            setShiftHeld(e.shiftKey);
        };
        const onKeyUp = (e: KeyboardEvent) => {
            setCmdHeld(e.metaKey);
            setShiftHeld(e.shiftKey);
        };
        const onBlur = () => {
            setCmdHeld(false);
            setShiftHeld(false);
        };
        window.addEventListener("keydown", onKeyDown);
        window.addEventListener("keyup", onKeyUp);
        window.addEventListener("blur", onBlur);
        return () => {
            window.removeEventListener("keydown", onKeyDown);
            window.removeEventListener("keyup", onKeyUp);
            window.removeEventListener("blur", onBlur);
        };
    }, []);

    return { cmdHeld, cmdShiftHeld: cmdHeld && shiftHeld };
}
