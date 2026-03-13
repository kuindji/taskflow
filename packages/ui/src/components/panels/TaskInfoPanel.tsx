import { useCallback, useEffect, useRef, useState } from "react";
import type { TaskLogEntryType } from "@taskflow/shared";
import { useTaskStore } from "@/stores/task-store";
import { useActiveWorkspace } from "@/hooks/useActiveWorkspace";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";

const logTypeStyles: Record<TaskLogEntryType, string> = {
    info: "bg-blue-500/20 text-blue-400 border-blue-500/30",
    commit: "bg-success/20 text-success border-success/30",
    warning: "bg-warning/20 text-warning border-warning/30",
    error: "bg-destructive/20 text-destructive border-destructive/30",
};

function formatLogTime(timestamp: string): string {
    const date = new Date(timestamp);
    return date.toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
    });
}

function TaskInfoPanel() {
    const workspace = useActiveWorkspace();
    const task = workspace.task;
    const { updateTask, fetchTaskLog } = useTaskStore();
    const taskLogs = useTaskStore((s) => (task ? s.taskLogs[task.id] : undefined));
    const [descriptionDraft, setDescriptionDraft] = useState("");
    const [notesDraft, setNotesDraft] = useState("");
    const lastSavedRef = useRef({ description: "", notes: "" });
    const draftRef = useRef({ description: "", notes: "" });
    const taskId = task?.id ?? null;

    useEffect(() => {
        draftRef.current = {
            description: descriptionDraft,
            notes: notesDraft,
        };
    });

    const persistDrafts = useCallback(
        (targetTaskId: string, description: string, notes: string) => {
            const updates: { description?: string; notes?: string } = {};
            if (description !== lastSavedRef.current.description) {
                updates.description = description;
            }
            if (notes !== lastSavedRef.current.notes) {
                updates.notes = notes;
            }
            if (Object.keys(updates).length === 0) return;

            lastSavedRef.current = { description, notes };

            void updateTask(targetTaskId, updates).catch((err: unknown) => {
                console.error("Failed to update task:", err);
            });
        },
        [updateTask],
    );

    useEffect(() => {
        if (!task) {
            setDescriptionDraft("");
            setNotesDraft("");
            lastSavedRef.current = { description: "", notes: "" };
            return;
        }

        setDescriptionDraft(task.description);
        setNotesDraft(task.notes);
        lastSavedRef.current = {
            description: task.description,
            notes: task.notes,
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally sync only when task identity changes, not on every task object update
    }, [taskId]);

    // Auto-save on debounce
    useEffect(() => {
        if (!taskId) return;
        if (
            descriptionDraft === lastSavedRef.current.description &&
            notesDraft === lastSavedRef.current.notes
        ) {
            return;
        }

        const timeoutId = window.setTimeout(() => {
            persistDrafts(taskId, draftRef.current.description, draftRef.current.notes);
        }, 400);
        return () => window.clearTimeout(timeoutId);
    }, [descriptionDraft, notesDraft, persistDrafts, taskId]);

    // Flush unsaved changes before switching tasks and on unmount.
    useEffect(() => {
        return () => {
            if (!taskId) return;
            persistDrafts(taskId, draftRef.current.description, draftRef.current.notes);
        };
    }, [persistDrafts, taskId]);

    // Fetch task log when task changes
    useEffect(() => {
        if (!taskId) return;
        void fetchTaskLog(taskId);
    }, [taskId, fetchTaskLog]);

    if (workspace.scope === "project" && workspace.project) {
        return (
            <div className="flex h-full flex-col">
                <div className="flex items-center px-3 py-2.5">
                    <span className="text-muted-foreground text-xs font-medium">Project Info</span>
                </div>
                <Separator />
                <ScrollArea className="flex-1 p-3">
                    <div className="space-y-4">
                        <div>
                            <label className="text-muted-foreground text-xs font-medium">
                                Name
                            </label>
                            <div className="text-secondary-foreground mt-1 text-sm">
                                {workspace.project.name}
                            </div>
                        </div>

                        <Separator className="my-4" />

                        <div>
                            <label className="text-muted-foreground text-xs font-medium">
                                Path
                            </label>
                            <div className="text-secondary-foreground mt-1 text-sm break-all">
                                {workspace.project.path}
                            </div>
                        </div>

                        <Separator className="my-4" />

                        <div>
                            <label className="text-muted-foreground text-xs font-medium">
                                Created
                            </label>
                            <div className="text-secondary-foreground mt-1 text-sm">
                                {new Date(workspace.project.createdAt).toLocaleString()}
                            </div>
                        </div>
                    </div>
                </ScrollArea>
            </div>
        );
    }

    if (!task) {
        return <div className="text-muted-foreground p-2 text-sm">Select a task or project</div>;
    }

    return (
        <div className="flex h-full flex-col">
            <div className="flex items-center px-3 py-2.5">
                <span className="text-muted-foreground text-xs font-medium">Task Info</span>
            </div>
            <Separator />

            <ScrollArea className="flex-1 p-3">
                <div className="space-y-4">
                    {/* Description */}
                    <div>
                        <label className="text-muted-foreground text-xs font-medium">
                            Description
                        </label>
                        <Textarea
                            value={descriptionDraft}
                            onChange={(e) => setDescriptionDraft(e.target.value)}
                            rows={4}
                            className="mt-1 text-sm"
                        />
                    </div>

                    <Separator className="my-4" />

                    {/* Branch */}
                    {task.worktree.branch && (
                        <div>
                            <label className="text-muted-foreground text-xs font-medium">
                                Branch
                            </label>
                            <div className="mt-1">
                                <Badge variant="outline" colorScheme="active">
                                    {task.worktree.branch}
                                </Badge>
                            </div>
                        </div>
                    )}

                    {/* Worktree */}
                    {task.worktree.path && (
                        <div>
                            <label className="text-muted-foreground text-xs font-medium">
                                Worktree
                            </label>
                            <div className="text-secondary-foreground mt-1 text-sm">
                                {task.worktree.path}
                            </div>
                        </div>
                    )}

                    <Separator className="my-4" />

                    {/* Created */}
                    <div>
                        <label className="text-muted-foreground text-xs font-medium">Created</label>
                        <div className="text-secondary-foreground mt-1 text-sm">
                            {new Date(task.createdAt).toLocaleString()}
                        </div>
                    </div>

                    <Separator className="my-4" />

                    {/* Notes */}
                    <div>
                        <label className="text-muted-foreground text-xs font-medium">Notes</label>
                        <Textarea
                            value={notesDraft}
                            onChange={(e) => setNotesDraft(e.target.value)}
                            rows={6}
                            placeholder="Add notes..."
                            className="mt-1 text-sm"
                        />
                    </div>

                    {/* Log */}
                    {taskLogs && taskLogs.length > 0 && (
                        <>
                            <Separator className="my-4" />
                            <div>
                                <label className="text-muted-foreground text-xs font-medium">
                                    Log
                                </label>
                                <div className="mt-2 space-y-2">
                                    {taskLogs.map((entry) => (
                                        <div
                                            key={entry.id}
                                            className="border-border/50 bg-muted/30 rounded-md border px-2.5 py-2"
                                        >
                                            <div className="flex items-center gap-2">
                                                <span
                                                    className={`inline-flex items-center rounded-full border px-1.5 py-0 text-[10px] font-medium ${logTypeStyles[entry.type]}`}
                                                >
                                                    {entry.type}
                                                </span>
                                                <span className="text-muted-foreground text-[10px]">
                                                    {formatLogTime(entry.timestamp)}
                                                </span>
                                            </div>
                                            <p className="text-secondary-foreground mt-1 text-xs leading-relaxed">
                                                {entry.message}
                                            </p>
                                            {entry.type === "commit" && entry.meta?.hash && (
                                                <code className="bg-muted text-accent mt-1 inline-block rounded px-1.5 py-0.5 font-mono text-[10px]">
                                                    {entry.meta.hash}
                                                </code>
                                            )}
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </>
                    )}
                </div>
            </ScrollArea>
        </div>
    );
}

export { TaskInfoPanel };
