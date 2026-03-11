import { useState, useCallback, useRef, useEffect } from "react";
import type { Project, Task } from "@taskflow/shared";
import { Collapsible, CollapsibleContent } from "@/components/ui/collapsible";
import { TaskCard } from "./TaskCard";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ChevronDown, ChevronRight, Pencil } from "lucide-react";
import { cn } from "@/lib/utils";

interface ProjectGroupProps {
    project: Project;
    tasks: Task[];
    activeTaskId: string | null;
    isActive: boolean;
    diffStats?: { additions: number; deletions: number } | null;
    onProjectClick: (projectId: string) => void;
    onTaskClick: (taskId: string) => void;
    onRename: (id: string, name: string) => void;
}

export function ProjectGroup({
    project,
    tasks,
    activeTaskId,
    isActive,
    diffStats,
    onProjectClick,
    onTaskClick,
    onRename,
}: ProjectGroupProps) {
    const [open, setOpen] = useState(true);
    const [editing, setEditing] = useState(false);
    const [editName, setEditName] = useState("");
    const inputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        if (editing) {
            inputRef.current?.select();
        }
    }, [editing]);

    const startEditing = useCallback(() => {
        setEditName(project.name);
        setEditing(true);
    }, [project.name]);

    const cancelEditing = useCallback(() => {
        setEditing(false);
        setEditName("");
    }, []);

    const submitEdit = useCallback(() => {
        const trimmed = editName.trim();
        if (trimmed && trimmed !== project.name) {
            onRename(project.id, trimmed);
        }
        setEditing(false);
    }, [editName, project.name, project.id, onRename]);

    const handleEditKeyDown = useCallback(
        (e: React.KeyboardEvent) => {
            e.stopPropagation();
            if (e.key === "Enter") {
                e.preventDefault();
                submitEdit();
            } else if (e.key === "Escape") {
                e.preventDefault();
                cancelEditing();
            }
        },
        [submitEdit, cancelEditing],
    );

    return (
        <Collapsible open={open} onOpenChange={setOpen}>
            <div
                className={cn(
                    "group mx-1.5 flex w-[calc(100%-0.75rem)] items-center gap-1 overflow-hidden rounded-lg px-1.5 py-1.5 transition-colors [-webkit-app-region:no-drag]",
                    isActive ? "bg-accent/15" : "hover:bg-muted/50",
                )}
            >
                <Button
                    variant="ghost"
                    size="icon-xs"
                    onClick={() => setOpen((value) => !value)}
                    className="text-muted-foreground h-6 w-6 shrink-0"
                >
                    {open ? (
                        <ChevronDown className="h-3.5 w-3.5" />
                    ) : (
                        <ChevronRight className="h-3.5 w-3.5" />
                    )}
                </Button>
                {editing ? (
                    <Input
                        ref={inputRef}
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        onKeyDown={handleEditKeyDown}
                        onBlur={submitEdit}
                        onClick={(e) => e.stopPropagation()}
                        className="mr-2 h-6 w-full text-xs"
                    />
                ) : (
                    <>
                        <button
                            onClick={() => onProjectClick(project.id)}
                            className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
                        >
                            <span className="text-muted-foreground truncate text-xs font-medium tracking-wide">
                                {project.name}
                            </span>
                        </button>
                        <button
                            onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                startEditing();
                            }}
                            className="text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100"
                        >
                            <Pencil className="h-3.5 w-3.5" />
                        </button>
                        {diffStats && (
                            <div className="ml-1 flex shrink-0 items-center gap-2 text-[10px] font-medium">
                                <span className="text-success">+{diffStats.additions}</span>
                                <span className="text-destructive">-{diffStats.deletions}</span>
                            </div>
                        )}
                    </>
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
