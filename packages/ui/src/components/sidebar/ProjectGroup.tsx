import { useState, useCallback, useRef, useEffect } from "react";
import type { Project, Task } from "@taskflow/shared";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Badge } from "@/components/ui/badge";
import { TaskCard } from "./TaskCard";
import { ChevronDown, ChevronRight, Pencil } from "lucide-react";

interface ProjectGroupProps {
    project: Project;
    tasks: Task[];
    activeTaskId: string | null;
    onTaskClick: (taskId: string) => void;
    onRename: (id: string, name: string) => void;
}

export function ProjectGroup({
    project,
    tasks,
    activeTaskId,
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
            <CollapsibleTrigger className="hover:bg-muted/50 group flex w-full cursor-pointer items-center justify-between px-2.5 py-1 transition-colors select-none">
                {editing ? (
                    <input
                        ref={inputRef}
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        onKeyDown={handleEditKeyDown}
                        onBlur={submitEdit}
                        onClick={(e) => e.stopPropagation()}
                        className="border-border focus:ring-ring text-foreground mr-2 h-5 flex-1 rounded border bg-transparent px-1 text-[9px] uppercase outline-none focus:ring-1"
                    />
                ) : (
                    <span className="text-muted-foreground flex items-center gap-1 text-[9px] uppercase">
                        {open ? (
                            <ChevronDown className="h-3 w-3" />
                        ) : (
                            <ChevronRight className="h-3 w-3" />
                        )}
                        {project.name}
                        <button
                            onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                startEditing();
                            }}
                            className="ml-0.5 opacity-0 transition-opacity group-hover:opacity-100"
                        >
                            <Pencil className="h-2.5 w-2.5" />
                        </button>
                    </span>
                )}
                <Badge variant="secondary" className="px-1.5 py-0 text-[8px]">
                    {tasks.length}
                </Badge>
            </CollapsibleTrigger>
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
