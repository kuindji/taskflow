import { useMemo } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import type { SessionRef, Task } from "@taskflow/shared";
import { useSessionStore } from "@/stores/session-store";
import { Badge } from "@/components/ui/badge";
import { StatusDot } from "@/components/ui/status-dot";
import { cn } from "@/lib/utils";

const taskCardVariants = cva(
    "px-3 py-2.5 mx-1.5 my-0.5 rounded-lg cursor-pointer transition-colors",
    {
        variants: {
            active: {
                true: "bg-accent/15 text-foreground",
                false: "text-secondary-foreground hover:bg-muted/50",
            },
        },
        defaultVariants: { active: false },
    },
);

interface TaskCardProps extends VariantProps<typeof taskCardVariants> {
    task: Task;
    isActive: boolean;
    onClick: () => void;
    className?: string;
}

function SessionBadge({ session }: { session: SessionRef }) {
    const status = useSessionStore((s) => s.sessionStatus[session.id] ?? "idle");

    return (
        <Badge
            variant="outline"
            colorScheme={session.type === "claude" ? "claude" : "codex"}
            className="px-1 py-0 text-xs"
        >
            <StatusDot status={status} className="mr-0.5" />
            {session.type}
        </Badge>
    );
}

export function TaskCard({ task, isActive, onClick, className }: TaskCardProps) {
    const cardClasses = useMemo(
        () => cn(taskCardVariants({ active: isActive }), className),
        [isActive, className],
    );

    const usingDescriptionAsTitle = !task.title && !!task.description;
    const title = task.title || task.description || "Untitled";
    const description =
        !usingDescriptionAsTitle && task.description
            ? task.description.length > 60
                ? task.description.slice(0, 60) + "\u2026"
                : task.description
            : null;

    return (
        <div onClick={onClick} className={cn(cardClasses, "[-webkit-app-region:no-drag]")}>
            <div className={cn("text-sm font-medium", isActive && "text-foreground")}>{title}</div>
            {description && (
                <div className="mt-0.5 text-xs text-muted-foreground line-clamp-1">
                    {description}
                </div>
            )}
            {task.sessions.length > 0 && (
                <div className="mt-1.5 flex gap-1.5">
                    {task.sessions.map((session) => (
                        <SessionBadge key={session.id} session={session} />
                    ))}
                </div>
            )}
        </div>
    );
}
