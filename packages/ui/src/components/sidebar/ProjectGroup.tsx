import { useState } from "react";
import type { Project, Task } from "@taskflow/shared";
import { Collapsible, CollapsibleContent } from "@/components/ui/collapsible";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { TaskCard } from "./TaskCard";
import { ChevronDown, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

interface ProjectGroupProps {
    project: Project;
    tasks: Task[];
    activeTaskId: string | null;
    isActive: boolean;
    diffStats?: { additions: number; deletions: number } | null;
    onProjectClick: (projectId: string) => void;
    onTaskClick: (taskId: string) => void;
}

export function ProjectGroup({
    project,
    tasks,
    activeTaskId,
    isActive,
    diffStats,
    onProjectClick,
    onTaskClick,
}: ProjectGroupProps) {
    const [open, setOpen] = useState(true);

    return (
        <Collapsible open={open} onOpenChange={setOpen}>
            <div
                className={cn(
                    "group mx-1.5 flex w-[calc(100%-0.75rem)] cursor-pointer items-center overflow-hidden rounded-lg transition-colors [-webkit-app-region:no-drag]",
                    isActive ? "bg-accent/15" : "hover:bg-muted/50",
                )}
            >
                <Tooltip>
                    <TooltipTrigger asChild>
                        <button
                            onClick={(e) => {
                                e.stopPropagation();
                                setOpen((value) => !value);
                            }}
                            aria-label={open ? "Collapse project" : "Expand project"}
                            className="text-muted-foreground flex h-full shrink-0 items-center px-1.5 py-1.5"
                        >
                            {open ? (
                                <ChevronDown className="h-3.5 w-3.5" />
                            ) : (
                                <ChevronRight className="h-3.5 w-3.5" />
                            )}
                        </button>
                    </TooltipTrigger>
                    <TooltipContent>{open ? "Collapse project" : "Expand project"}</TooltipContent>
                </Tooltip>
                <button
                    onClick={() => onProjectClick(project.id)}
                    className="flex min-w-0 flex-1 cursor-pointer items-center gap-1.5 py-1.5 pr-1.5 text-left"
                >
                    <span className="text-muted-foreground truncate text-xs font-medium tracking-wide">
                        {project.name}
                    </span>
                </button>
                {diffStats && (
                    <div className="mr-1.5 flex shrink-0 items-center gap-2 text-[10px] font-medium">
                        <span className="text-success">+{diffStats.additions}</span>
                        <span className="text-destructive">-{diffStats.deletions}</span>
                    </div>
                )}
            </div>
            <CollapsibleContent>
                {tasks.map((task) => (
                    <TaskCard
                        key={task.id}
                        task={task}
                        isActive={task.id === activeTaskId}
                        onClick={() => onTaskClick(task.id)}
                    />
                ))}
            </CollapsibleContent>
        </Collapsible>
    );
}
