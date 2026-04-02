import { WifiOff } from "lucide-react";
import { useConnectivity } from "@/hooks/useConnectivity";
import { Button } from "@/components/ui/button";

function OfflineIndicator() {
    const online = useConnectivity();

    if (online) return null;

    return (
        <Button
            variant="ghost"
            size="icon-xs"
            disabled
            aria-label="No internet connection"
            tooltip="No internet connection — agent features disabled"
            tooltipSide="right"
            className="text-destructive [-webkit-app-region:no-drag]">
            <WifiOff className="h-3.5 w-3.5" />
        </Button>
    );
}

export { OfflineIndicator };
