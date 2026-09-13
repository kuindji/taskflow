import { useState } from "react";
import { Loader2, ServerOff, WifiOff } from "lucide-react";
import { recheckConnectivity, useConnectivity } from "@/hooks/useConnectivity";
import { useWorkspaceBackend } from "@/hooks/useWorkspaceBackend";
import { Button } from "@/components/ui/button";
import { useBackendStore } from "@/stores/backend-store";

/** Primary has no internet connection. */
function InternetOfflineIndicator() {
    const online = useConnectivity();
    const [checking, setChecking] = useState(false);

    if (online) return null;

    async function handleClick(): Promise<void> {
        setChecking(true);
        try {
            await recheckConnectivity();
        } finally {
            setChecking(false);
        }
    }

    return (
        <Button
            variant="ghost"
            size="icon-xs"
            onClick={() => void handleClick()}
            disabled={checking}
            aria-label={checking ? "Checking internet connection" : "Retry internet connection"}
            tooltip={
                checking
                    ? "Checking internet connection..."
                    : "No internet connection — click to retry"
            }
            tooltipSide="right"
            className="text-destructive [-webkit-app-region:no-drag]">
            {checking ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
                <WifiOff className="h-3.5 w-3.5" />
            )}
        </Button>
    );
}

/**
 * The open workspace's machine is unreachable. Only that machine: another one
 * being down costs its own sidebar section, and work elsewhere carries on.
 */
function WorkspaceMachineIndicator() {
    const backendId = useWorkspaceBackend();
    const machine = useBackendStore((s) => s.machines.find((m) => m.id === backendId));
    const retry = useBackendStore((s) => s.retry);

    if (!machine || (machine.state !== "offline" && machine.state !== "incompatible")) {
        return null;
    }

    const offline = machine.state === "offline";
    const label = `${machine.displayName} ${offline ? "offline" : "needs update"}`;
    const detail = offline
        ? (machine.failure?.message ?? "Not connected")
        : "Running a different protocol version";

    return (
        <Button
            variant="ghost"
            size="xs"
            onClick={() => retry(machine.id)}
            aria-label={`Retry ${machine.displayName}`}
            tooltip={`${detail} — click to retry`}
            tooltipSide="right"
            className="text-destructive max-w-40 [-webkit-app-region:no-drag]">
            <ServerOff className="h-3.5 w-3.5" />
            <span className="truncate">{label}</span>
        </Button>
    );
}

function OfflineIndicator() {
    return (
        <>
            <WorkspaceMachineIndicator />
            <InternetOfflineIndicator />
        </>
    );
}

export { OfflineIndicator };
