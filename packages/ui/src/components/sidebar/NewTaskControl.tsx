import { useTaskCreationStore } from "@/stores/task-creation-store";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface NewTaskControlProps {
    className?: string;
    iconClassName?: string;
    size?: "xs" | "sm";
}

export function NewTaskControl({ className, iconClassName, size = "xs" }: NewTaskControlProps) {
    const requestNewTask = useTaskCreationStore((s) => s.requestNewTask);

    return (
        <Button
            variant="ghost"
            size={size}
            onClick={requestNewTask}
            tooltip="New task (Cmd+N)"
            className={cn("text-muted-foreground text-sm [-webkit-app-region:no-drag]", className)}
        >
            <Plus className={cn("h-4 w-4", iconClassName)} />
            Task
        </Button>
    );
}
