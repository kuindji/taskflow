import type { ComponentProps } from "react";
import { useTaskCreationStore } from "@/stores/task-creation-store";
import { FilePlus, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface NewTaskControlProps {
    className?: string;
    iconClassName?: string;
    iconOnly?: boolean;
    size?: "xs" | "sm";
    tooltipSide?: ComponentProps<typeof Button>["tooltipSide"];
}

export function NewTaskControl({
    className,
    iconClassName,
    iconOnly,
    size = "xs",
    tooltipSide,
}: NewTaskControlProps) {
    const requestNewTask = useTaskCreationStore((s) => s.requestNewTask);

    return (
        <Button
            variant="ghost"
            size={iconOnly ? "icon-xs" : size}
            onClick={() => requestNewTask()}
            tooltip="New task (Cmd+N)"
            tooltipSide={tooltipSide}
            className={cn("[-webkit-app-region:no-drag]", className)}>
            {iconOnly ? (
                <FilePlus className={cn("h-4 w-4", iconClassName)} />
            ) : (
                <>
                    <Plus className={cn("h-4 w-4", iconClassName)} />
                    Task
                </>
            )}
        </Button>
    );
}
