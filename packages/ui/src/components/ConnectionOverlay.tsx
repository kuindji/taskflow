import { useRef, useState } from "react";
import { useWsStatus } from "@/providers/ws-context";
import { useBackendStore } from "@/stores/backend-store";
import { useRegisterOverlay } from "@/lib/overlay-registry";
import { Button } from "@/components/ui/button";
import { switchRefusal } from "@/components/sidebar/MachinesMenu";

export function ConnectionOverlay() {
    const { connected, error } = useWsStatus();
    const ref = useRef<HTMLDivElement>(null);
    // Hosted browser views sit above the DOM; registering freezes them under the blocker.
    useRegisterOverlay(ref, !connected);
    const primaryId = useBackendStore((s) => s.primaryId);
    const primary = useBackendStore((s) => s.machines.find((m) => m.id === primaryId));
    const switching = useBackendStore((s) => s.switching);
    const [refusal, setRefusal] = useState<string | null>(null);
    const remoteFailure = primary && !primary.isLocal ? primary.failure : undefined;
    const message = remoteFailure?.message ?? error;
    async function returnToLocal() {
        const result = await useBackendStore.getState().returnToLocal();
        setRefusal(result.ok ? null : switchRefusal(result));
    }
    if (connected) return null;
    return (
        <div
            ref={ref}
            className="bg-background/80 fixed inset-0 z-50 flex items-center justify-center backdrop-blur-sm">
            <div className="space-y-2 text-center">
                <div className="text-foreground text-sm font-medium">
                    {message ? "Connection Failed" : "Connecting to backend..."}
                </div>
                {message && <div className="text-destructive text-xs">{message}</div>}
                {!message && <div className="text-muted-foreground text-xs">Reconnecting...</div>}
                {remoteFailure && (
                    <Button disabled={switching} onClick={() => void returnToLocal()}>
                        Return to local
                    </Button>
                )}
                {refusal && <div className="text-destructive text-xs">{refusal}</div>}
            </div>
        </div>
    );
}
