import { useState, useCallback, useRef, useEffect } from "react";
import type { Project, Task } from "@taskflow/shared";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Badge } from "@/components/ui/badge";
import { TaskCard } from "./TaskCard";
import { Input } from "@/components/ui/input";
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
            <CollapsibleTrigger className="hover:bg-muted/50 group mx-2 flex w-[calc(100%-1rem)] cursor-pointer items-center justify-between overflow-hidden rounded-lg px-3 py-2.5 transition-colors select-none">
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
                    <span className="text-muted-foreground flex items-center gap-1.5 text-xs font-medium tracking-wide">
                        {open ? (
                            <ChevronDown className="h-3.5 w-3.5 shrink-0" />
                        ) : (
                            <ChevronRight className="h-3.5 w-3.5 shrink-0" />
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
                            <Pencil className="h-3.5 w-3.5" />
                        </button>
                    </span>
                )}
                <Badge variant="secondary" className="min-w-5 px-1.5 py-0 text-center text-[10px] font-normal">
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
