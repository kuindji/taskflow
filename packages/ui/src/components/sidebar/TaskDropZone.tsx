import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { useTaskDropZone } from "./hooks/useTaskDropZone";

interface TaskDropZoneProps {
    /** Pins the new task to this project. Omitted for the sidebar-wide zone. */
    projectId?: string;
    /**
     * An archived project is not a target: `selectableProjectId` refuses a
     * hidden project, so pinning one would open the dialog with no project
     * selected and no way to submit. Left off, the drop falls through to the
     * sidebar-wide zone, which is the sensible thing for it to do.
     */
    enabled?: boolean;
    className?: string;
    children: ReactNode;
}

function TaskDropZone({ projectId, enabled = true, className, children }: TaskDropZoneProps) {
    const { isOver, handlers } = useTaskDropZone(projectId);
    const active = enabled && isOver;
    return (
        <div
            className={cn(className, active && "ring-primary/50 rounded-sm ring-2 ring-inset")}
            {...(enabled ? handlers : {})}>
            {children}
        </div>
    );
}

export { TaskDropZone };
