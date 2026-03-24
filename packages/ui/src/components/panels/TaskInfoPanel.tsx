import { useCallback, useEffect, useRef, useState } from "react";
import type { TaskLogEntryType } from "@taskflow/shared";
import { X } from "lucide-react";
import { useProjectStore } from "@/stores/project-store";
import { useTaskStore } from "@/stores/task-store";
import { useUIStore } from "@/stores/ui-store";
import { useActiveWorkspace } from "@/hooks/useActiveWorkspace";
import { Input } from "@/components/ui/input";
import { ExpandableTextarea } from "@/components/ui/expandable-textarea";
import { Badge } from "@/components/ui/badge";
import { CopyButton } from "@/components/ui/copy-button";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Toolbar } from "@/components/ui/toolbar";

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
    const project = workspace.project;
    const { updateTask, fetchTaskLog } = useTaskStore();
    const updateProject = useProjectStore((s) => s.updateProject);
    const toggleTaskInfo = useUIStore((s) => s.toggleTaskInfo);
    const taskLogs = useTaskStore((s) => (task ? s.taskLogs[task.id] : undefined));
    const [titleDraft, setTitleDraft] = useState("");
    const [descriptionDraft, setDescriptionDraft] = useState("");
    const [notesDraft, setNotesDraft] = useState("");
    const [projectTitleDraft, setProjectTitleDraft] = useState("");
    const [projectInitCommandDraft, setProjectInitCommandDraft] = useState("");
    const lastSavedRef = useRef({ title: "", description: "", notes: "" });
    const draftRef = useRef({ title: "", description: "", notes: "" });
    const lastSavedProjectRef = useRef({ name: "", defaultInitCommand: "" });
    const projectDraftRef = useRef({ name: "", defaultInitCommand: "" });
    const taskId = task?.id ?? null;
    const projectId = workspace.scope === "project" ? (project?.id ?? null) : null;

    useEffect(() => {
        draftRef.current = {
            title: titleDraft,
            description: descriptionDraft,
            notes: notesDraft,
        };
    }, [descriptionDraft, notesDraft, titleDraft]);

    useEffect(() => {
        projectDraftRef.current = {
            name: projectTitleDraft,
            defaultInitCommand: projectInitCommandDraft,
        };
    }, [projectInitCommandDraft, projectTitleDraft]);

    const persistDrafts = useCallback(
        (targetTaskId: string, title: string, description: string, notes: string) => {
            const updates: { title?: string; description?: string; notes?: string } = {};
            if (title !== lastSavedRef.current.title) {
                updates.title = title;
            }
            if (description !== lastSavedRef.current.description) {
                updates.description = description;
            }
            if (notes !== lastSavedRef.current.notes) {
                updates.notes = notes;
            }
            if (Object.keys(updates).length === 0) return;

            lastSavedRef.current = { title, description, notes };

            void updateTask(targetTaskId, updates).catch((err: unknown) => {
                console.error("Failed to update task:", err);
            });
        },
        [updateTask],
    );

    const persistProjectDrafts = useCallback(
        (targetProjectId: string, name: string, defaultInitCommand: string) => {
            const updates: { name?: string; defaultInitCommand?: string } = {};
            if (name !== lastSavedProjectRef.current.name) {
                updates.name = name;
            }
            if (defaultInitCommand !== lastSavedProjectRef.current.defaultInitCommand) {
                updates.defaultInitCommand = defaultInitCommand;
            }
            if (Object.keys(updates).length === 0) return;

            lastSavedProjectRef.current = { name, defaultInitCommand };

            void updateProject(targetProjectId, updates).catch((err: unknown) => {
                console.error("Failed to update project:", err);
            });
        },
        [updateProject],
    );

    useEffect(() => {
        if (!task) {
            setTitleDraft("");
            setDescriptionDraft("");
            setNotesDraft("");
            lastSavedRef.current = { title: "", description: "", notes: "" };
            return;
        }

        setTitleDraft(task.title);
        setDescriptionDraft(task.description);
        setNotesDraft(task.notes);
        lastSavedRef.current = {
            title: task.title,
            description: task.description,
            notes: task.notes,
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally sync only when task identity changes, not on every task object update
    }, [taskId]);

    useEffect(() => {
        if (workspace.scope !== "project" || !project) {
            setProjectTitleDraft("");
            setProjectInitCommandDraft("");
            lastSavedProjectRef.current = { name: "", defaultInitCommand: "" };
            return;
        }

        setProjectTitleDraft(project.name);
        setProjectInitCommandDraft(project.defaultInitCommand ?? "");
        lastSavedProjectRef.current = {
            name: project.name,
            defaultInitCommand: project.defaultInitCommand ?? "",
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally sync only when project identity changes, not on every project object update
    }, [projectId]);

    // Auto-save on debounce
    useEffect(() => {
        if (!taskId) return;
        if (
            titleDraft === lastSavedRef.current.title &&
            descriptionDraft === lastSavedRef.current.description &&
            notesDraft === lastSavedRef.current.notes
        ) {
            return;
        }

        const timeoutId = window.setTimeout(() => {
            persistDrafts(
                taskId,
                draftRef.current.title,
                draftRef.current.description,
                draftRef.current.notes,
            );
        }, 400);
        return () => window.clearTimeout(timeoutId);
    }, [descriptionDraft, notesDraft, persistDrafts, taskId, titleDraft]);

    useEffect(() => {
        if (!projectId) return;
        if (
            projectTitleDraft === lastSavedProjectRef.current.name &&
            projectInitCommandDraft === lastSavedProjectRef.current.defaultInitCommand
        ) {
            return;
        }

        const timeoutId = window.setTimeout(() => {
            persistProjectDrafts(
                projectId,
                projectDraftRef.current.name,
                projectDraftRef.current.defaultInitCommand,
            );
        }, 400);
        return () => window.clearTimeout(timeoutId);
    }, [persistProjectDrafts, projectId, projectInitCommandDraft, projectTitleDraft]);

    // Flush unsaved changes before switching tasks and on unmount.
    useEffect(() => {
        return () => {
            if (!taskId) return;
            persistDrafts(
                taskId,
                draftRef.current.title,
                draftRef.current.description,
                draftRef.current.notes,
            );
        };
    }, [persistDrafts, taskId]);

    useEffect(() => {
        return () => {
            if (!projectId) return;
            persistProjectDrafts(
                projectId,
                projectDraftRef.current.name,
                projectDraftRef.current.defaultInitCommand,
            );
        };
    }, [persistProjectDrafts, projectId]);

    // Fetch task log when task changes
    useEffect(() => {
        if (!taskId) return;
        void fetchTaskLog(taskId);
    }, [taskId, fetchTaskLog]);

    if (workspace.scope === "project" && project) {
        return (
            <div className="flex h-full flex-col">
                <Toolbar className="gap-2">
                    <span className="text-muted-foreground ml-2 text-xs font-medium">
                        Project Info
                    </span>
                    <div className="flex-1" />
                    <Button
                        variant="ghost"
                        size="icon-xs"
                        onClick={toggleTaskInfo}
                        aria-label="Hide project info"
                        tooltip="Hide project info"
                        tooltipSide="bottom">
                        <X className="h-3 w-3" />
                    </Button>
                </Toolbar>
                <div className="flex-1 overflow-y-auto p-3">
                    <div className="space-y-4">
                        <div>
                            <label
                                htmlFor="project-info-title"
                                className="text-muted-foreground text-xs font-medium">
                                Title
                            </label>
                            <Input
                                id="project-info-title"
                                value={projectTitleDraft}
                                onChange={(e) => setProjectTitleDraft(e.target.value)}
                                placeholder="Short project name..."
                                className="mt-1 text-sm"
                            />
                        </div>

                        <Separator className="my-4" />

                        <div>
                            <label
                                htmlFor="project-info-default-init-command"
                                className="text-muted-foreground text-xs font-medium">
                                Default Workspace Init Command
                            </label>
                            <Input
                                id="project-info-default-init-command"
                                value={projectInitCommandDraft}
                                onChange={(e) => setProjectInitCommandDraft(e.target.value)}
                                placeholder="bun install"
                                className="mt-1 text-sm"
                            />
                            <p className="text-muted-foreground mt-1 text-xs">
                                Used as the default init command when creating worktree tasks.
                            </p>
                        </div>

                        <Separator className="my-4" />

                        <div>
                            <span className="text-muted-foreground text-xs font-medium">Path</span>
                            <div className="text-secondary-foreground mt-1 text-sm break-all">
                                {project.path}
                            </div>
                        </div>

                        <Separator className="my-4" />

                        <div>
                            <span className="text-muted-foreground text-xs font-medium">
                                Created
                            </span>
                            <div className="text-secondary-foreground mt-1 text-sm">
                                {new Date(project.createdAt).toLocaleString()}
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    if (!task) {
        return <div className="text-muted-foreground p-2 text-sm">Select a task or project</div>;
    }

    return (
        <div className="flex h-full flex-col">
            <Toolbar className="gap-2">
                <span className="text-muted-foreground ml-2 text-xs font-medium">Task Info</span>
                <div className="flex-1" />
                <Button
                    variant="ghost"
                    size="icon-xs"
                    onClick={toggleTaskInfo}
                    aria-label="Hide task info"
                    tooltip="Hide task info"
                    tooltipSide="bottom">
                    <X className="h-3 w-3" />
                </Button>
            </Toolbar>

            <div className="flex-1 overflow-y-auto p-3">
                <div className="space-y-4">
                    <div>
                        <label
                            htmlFor="task-info-title"
                            className="text-muted-foreground text-xs font-medium">
                            Title
                        </label>
                        <Input
                            id="task-info-title"
                            value={titleDraft}
                            onChange={(e) => setTitleDraft(e.target.value)}
                            placeholder="Short task name..."
                            className="mt-1 text-sm"
                        />
                    </div>

                    <Separator className="my-4" />

                    {/* Description */}
                    <div>
                        <label
                            htmlFor="task-info-description"
                            className="text-muted-foreground text-xs font-medium">
                            Description
                        </label>
                        <ExpandableTextarea
                            id="task-info-description"
                            dialogTitle="Description"
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
                            <span className="text-muted-foreground text-xs font-medium">
                                Branch
                            </span>
                            <div className="mt-1 flex items-center gap-1">
                                <Badge variant="outline" colorScheme="active">
                                    {task.worktree.branch}
                                </Badge>
                                <CopyButton
                                    value={task.worktree.branch}
                                    tooltip="Copy branch name"
                                />
                            </div>
                        </div>
                    )}

                    {/* Worktree */}
                    {task.worktree.path && (
                        <div>
                            <span className="text-muted-foreground text-xs font-medium">
                                Worktree
                            </span>
                            <div className="text-secondary-foreground mt-1 flex items-center gap-1 text-sm">
                                <span className="break-all">{task.worktree.path}</span>
                                <CopyButton
                                    value={task.worktree.path}
                                    tooltip="Copy worktree path"
                                    className="shrink-0"
                                />
                            </div>
                        </div>
                    )}

                    <Separator className="my-4" />

                    {/* Created */}
                    <div>
                        <span className="text-muted-foreground text-xs font-medium">Created</span>
                        <div className="text-secondary-foreground mt-1 text-sm">
                            {new Date(task.createdAt).toLocaleString()}
                        </div>
                    </div>

                    <Separator className="my-4" />

                    {/* Notes */}
                    <div>
                        <label
                            htmlFor="task-info-notes"
                            className="text-muted-foreground text-xs font-medium">
                            Notes
                        </label>
                        <ExpandableTextarea
                            id="task-info-notes"
                            dialogTitle="Notes"
                            showInfoButton={false}
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
                                <span className="text-muted-foreground text-xs font-medium">
                                    Log
                                </span>
                                <div className="mt-2 space-y-2">
                                    {taskLogs.map((entry) => (
                                        <div
                                            key={entry.id}
                                            className="border-border/50 bg-muted/30 rounded-md border px-2.5 py-2">
                                            <div className="flex items-center gap-2">
                                                <span
                                                    className={`inline-flex items-center rounded-full border px-1.5 py-0 text-[10px] font-medium ${logTypeStyles[entry.type]}`}>
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
            </div>
        </div>
    );
}

export { TaskInfoPanel };
