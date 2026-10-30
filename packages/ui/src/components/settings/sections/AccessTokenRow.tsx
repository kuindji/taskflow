import { useEffect, useState } from "react";
import { SettingRow } from "./SettingRow";
import { CopyButton } from "@/components/ui/copy-button";

export function AccessTokenRow() {
    const [token, setToken] = useState<string | null>(null);
    useEffect(() => {
        let active = true;
        void window.taskflow?.getLocalApiToken().then((value) => {
            if (active) setToken(value);
        });
        return () => {
            active = false;
        };
    }, []);
    if (!token) return null;
    return (
        <SettingRow
            label="Access token"
            hint="For machines that can't read it over ssh: paste it in their connect dialog"
            className="px-3 py-2">
            <span className="font-mono text-xs">{token.slice(0, 6)}…</span>
            <CopyButton value={token} />
        </SettingRow>
    );
}
