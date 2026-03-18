import type { ComponentProps } from "react";
import { useTaskCreationStore } from "@/stores/task-creation-store";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface NewTaskControlProps {
    className?: string;
    iconClassName?: string;
    size?: "xs" | "sm";
    tooltipSide?: ComponentProps<typeof Button>["tooltipSide"];
}

export function NewTaskControl({
    className,
    iconClassName,
    size = "xs",
    tooltipSide,
}: NewTaskControlProps) {
    const requestNewTask = useTaskCreationStore((s) => s.requestNewTask);

    return (
        <Button
            variant="ghost"
            size={size}
            onClick={requestNewTask}
            tooltip="New task (Cmd+N)"
            tooltipSide={tooltipSide}
            className={cn("[-webkit-app-region:no-drag]", className)}>
            <Plus className={cn("h-4 w-4", iconClassName)} />
            Task
        </Button>
    );
}
