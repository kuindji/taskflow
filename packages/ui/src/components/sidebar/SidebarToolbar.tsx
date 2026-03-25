import { CalendarClock, Palette, Settings2, Workflow } from "lucide-react";
import { Button } from "@/components/ui/button";

interface SidebarToolbarProps {
    onFlows: () => void;
    onSchedules: () => void;
    onAppearance: () => void;
    onSettings: () => void;
}

function SidebarToolbar({ onFlows, onSchedules, onAppearance, onSettings }: SidebarToolbarProps) {
    return (
        <div className="flex items-center">
            <Button
                variant="ghost"
                size="icon-xs"
                onClick={onFlows}
                aria-label="Actions and Flows"
                tooltip="Actions and Flows"
                tooltipSide="bottom"
                className="[-webkit-app-region:no-drag]">
                <Workflow className="h-3.5 w-3.5" />
            </Button>
            <Button
                variant="ghost"
                size="icon-xs"
                onClick={onSchedules}
                aria-label="Schedules"
                tooltip="Schedules"
                tooltipSide="bottom"
                className="[-webkit-app-region:no-drag]">
                <CalendarClock className="h-3.5 w-3.5" />
            </Button>
            <Button
                variant="ghost"
                size="icon-xs"
                onClick={onAppearance}
                aria-label="Appearance"
                tooltip="Appearance"
                tooltipSide="bottom"
                className="[-webkit-app-region:no-drag]">
                <Palette className="h-3.5 w-3.5" />
            </Button>
            <Button
                variant="ghost"
                size="icon-xs"
                onClick={onSettings}
                aria-label="Settings"
                tooltip="Settings"
                tooltipSide="bottom"
                className="[-webkit-app-region:no-drag]">
                <Settings2 className="h-3.5 w-3.5" />
            </Button>
        </div>
    );
}

export { SidebarToolbar };
