import { useState, useEffect } from "react";

export function useCmdHeld() {
    const [cmdHeld, setCmdHeld] = useState(false);

    useEffect(() => {
        const onKeyDown = (e: KeyboardEvent) => {
            if (e.key === "Meta") setCmdHeld(true);
        };
        const onKeyUp = (e: KeyboardEvent) => {
            if (e.key === "Meta") setCmdHeld(false);
        };
        const onBlur = () => setCmdHeld(false);
        window.addEventListener("keydown", onKeyDown);
        window.addEventListener("keyup", onKeyUp);
        window.addEventListener("blur", onBlur);
        return () => {
            window.removeEventListener("keydown", onKeyDown);
            window.removeEventListener("keyup", onKeyUp);
            window.removeEventListener("blur", onBlur);
        };
    }, []);

    return cmdHeld;
}
