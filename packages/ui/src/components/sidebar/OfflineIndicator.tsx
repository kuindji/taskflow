import { useState } from "react";
import { Loader2, WifiOff } from "lucide-react";
import { recheckConnectivity, useConnectivity } from "@/hooks/useConnectivity";
import { Button } from "@/components/ui/button";

function OfflineIndicator() {
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

export { OfflineIndicator };
