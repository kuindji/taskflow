import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import type { AttributeLayer, TaskLogEntryType } from "@taskflow/shared";
import { X } from "lucide-react";
import { useProjectStore } from "@/stores/project-store";
import { useTaskStore } from "@/stores/task-store";
import { useUIStore } from "@/stores/ui-store";
import { useActiveWorkspace } from "@/hooks/useActiveWorkspace";
import { isStaleReply, restoreFailedBaseline, trackSave } from "@/lib/draft-baseline";
import { usePanelActivation } from "@/hooks/usePanelActivation";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ExpandableTextarea } from "@/components/ui/expandable-textarea";
import { CopyButton } from "@/components/ui/copy-button";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Toolbar } from "@/components/ui/toolbar";
import { TruncatedText } from "@/components/ui/truncated-text";
import { AttributesSection } from "@/components/panels/AttributesSection";
import { EditedFilesList } from "@/components/panels/EditedFilesList";
import { LinkedProjectsSection } from "@/components/panels/LinkedProjectsSection";
import { ProjectAgentAccountsSection } from "@/components/panels/ProjectAgentAccountsSection";

const logTypeStyles: Record<TaskLogEntryType, string> = {
    info: "bg-blue-500/20 text-blue-400 border-blue-500/30",
    commit: "bg-success/20 text-success border-success/30",
    warning: "bg-warning/20 text-warning border-warning/30",
    error: "bg-destructive/20 text-destructive border-destructive/30",
    file: "bg-muted/20 text-muted-foreground border-muted/30",
};

// Stable reference for the project panel's inheritedLayers prop: an inline
// `[]` literal is a fresh array every render, which defeats the `inherited`
// useMemo inside AttributesSection (it never sees an unchanged dep).
const NO_LAYERS: AttributeLayer[] = [];

function formatLogTime(timestamp: string): string {
    const date = new Date(timestamp);
    return date.toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
    });
}

/**
 * Moves the shown record's fields that changed since `received` into the
 * baseline and returns them for the drafts, except a field whose draft holds
 * an unsaved edit or that an older save's reply carries (see `isStaleReply`).
 * A value changed elsewhere (an agent's `taskflow-cli task update`, the TUI,
 * another client) then replaces a clean draft instead of being written back
 * by the next edit.
 */
function adoptChangedFields<T extends Record<string, string>>(
    received: T,
    incoming: T,
    drafts: T,
    baseline: RefObject<T>,
    pending: readonly T[],
): Partial<T> {
    const adopted: Partial<T> = {};
    const next = { ...baseline.current };
    for (const key of Object.keys(incoming) as (keyof T)[]) {
        if (received[key] === incoming[key] || drafts[key] !== baseline.current[key]) continue;
        if (isStaleReply(pending, (sent) => sent[key] === incoming[key])) continue;
        adopted[key] = incoming[key];
        next[key] = incoming[key];
    }
    baseline.current = next;
    return adopted;
}

function TaskInfoPanel() {
    // Focus the first input field when navigation mode ends on this panel
    usePanelActivation(
        "taskinfo",
        useCallback(() => {
            requestAnimationFrame(() => {
                const panel = document.querySelector('[data-panel="taskinfo"]');
                const input = panel?.querySelector("input, textarea, select") as HTMLElement | null;
                input?.focus();
            });
        }, []),
    );

    const workspace = useActiveWorkspace();
    const task = workspace.task;
    const project = workspace.project;
    const updateTask = useTaskStore((s) => s.updateTask);
    const fetchTaskLog = useTaskStore((s) => s.fetchTaskLog);
    const updateProject = useProjectStore((s) => s.updateProject);
    const toggleTaskInfo = useUIStore((s) => s.toggleTaskInfo);
    const allLogs = useTaskStore((s) => (task ? s.taskLogs[task.id] : undefined));
    const parentTask = useTaskStore((s) =>
        task?.parentId ? s.tasks.find((t) => t.id === task.parentId) : undefined,
    );
    const taskProject = useProjectStore((s) =>
        task ? s.projects.find((p) => p.id === task.projectId) : undefined,
    );
    const inheritedLayers = useMemo<AttributeLayer[]>(() => {
        const layers: AttributeLayer[] = [
            { scope: "project", attributes: taskProject?.attributes ?? [] },
        ];
        if (task?.parentId) {
            layers.push({ scope: "parent", attributes: parentTask?.attributes ?? [] });
        }
        return layers;
    }, [parentTask, task?.parentId, taskProject]);
    const editedFiles = useMemo(() => (allLogs ?? []).filter((e) => e.type === "file"), [allLogs]);
    const taskLogs = useMemo(() => {
        if (!allLogs) return undefined;
        const filtered = allLogs.filter((e) => e.type !== "file");
        return filtered.length > 0 ? filtered : undefined;
    }, [allLogs]);
    const [titleDraft, setTitleDraft] = useState("");
    const [descriptionDraft, setDescriptionDraft] = useState("");
    const [notesDraft, setNotesDraft] = useState("");
    const [projectTitleDraft, setProjectTitleDraft] = useState("");
    const [projectInitCommandDraft, setProjectInitCommandDraft] = useState("");
    const [projectPromptDraft, setProjectPromptDraft] = useState("");
    const lastSavedRef = useRef({ title: "", description: "", notes: "" });
    const draftRef = useRef({ title: "", description: "", notes: "" });
    const lastSavedProjectRef = useRef({ name: "", defaultInitCommand: "", prompt: "" });
    const projectDraftRef = useRef({ name: "", defaultInitCommand: "", prompt: "" });
    const taskId = task?.id ?? null;
    const projectId = workspace.scope === "project" ? (project?.id ?? null) : null;
    // The record the baselines above describe, for saves that settle later.
    const shownTaskIdRef = useRef(taskId);
    const shownProjectIdRef = useRef(projectId);
    // The fields last received from the shown records.
    const receivedTaskRef = useRef<typeof lastSavedRef.current | null>(null);
    const receivedProjectRef = useRef<typeof lastSavedProjectRef.current | null>(null);
    // The fields sent by saves whose replies are pending.
    const pendingTaskSavesRef = useRef<(typeof lastSavedRef.current)[]>([]);
    const pendingProjectSavesRef = useRef<(typeof lastSavedProjectRef.current)[]>([]);
    const taskTitle = task?.title;
    const taskDescription = task?.description;
    const taskNotes = task?.notes;
    const shownProject = projectId ? project : null;
    const projectName = shownProject?.name;
    const projectInitCommand = shownProject?.defaultInitCommand;
    const projectPrompt = shownProject?.prompt;

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
            prompt: projectPromptDraft,
        };
    }, [projectInitCommandDraft, projectPromptDraft, projectTitleDraft]);

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

            const previous = lastSavedRef.current;
            const attempted = { title, description, notes };
            lastSavedRef.current = attempted;

            // Looked up now: the unmount flush can outlive the record.
            const target = useTaskStore.getState().tasks.find((t) => t.id === targetTaskId);
            if (!target) return;
            void trackSave(pendingTaskSavesRef, attempted, updateTask(target, updates)).catch(
                (err: unknown) => {
                    console.error("Failed to update task:", err);
                    if (shownTaskIdRef.current === targetTaskId) {
                        restoreFailedBaseline(lastSavedRef, previous, attempted);
                    }
                },
            );
        },
        [updateTask],
    );

    const persistProjectDrafts = useCallback(
        (targetProjectId: string, name: string, defaultInitCommand: string, prompt: string) => {
            const updates: { name?: string; defaultInitCommand?: string; prompt?: string } = {};
            if (name !== lastSavedProjectRef.current.name) {
                updates.name = name;
            }
            if (defaultInitCommand !== lastSavedProjectRef.current.defaultInitCommand) {
                updates.defaultInitCommand = defaultInitCommand;
            }
            if (prompt !== lastSavedProjectRef.current.prompt) {
                updates.prompt = prompt;
            }
            if (Object.keys(updates).length === 0) return;

            const previous = lastSavedProjectRef.current;
            const attempted = { name, defaultInitCommand, prompt };
            lastSavedProjectRef.current = attempted;

            const target = useProjectStore
                .getState()
                .projects.find((p) => p.id === targetProjectId);
            if (!target) return;
            void trackSave(pendingProjectSavesRef, attempted, updateProject(target, updates)).catch(
                (err: unknown) => {
                    console.error("Failed to update project:", err);
                    if (shownProjectIdRef.current === targetProjectId) {
                        restoreFailedBaseline(lastSavedProjectRef, previous, attempted);
                    }
                },
            );
        },
        [updateProject],
    );

    // A new record resets the drafts; a field changed on the shown record
    // replaces its draft unless the draft has an unsaved edit.
    useEffect(() => {
        const incoming = {
            title: taskTitle ?? "",
            description: taskDescription ?? "",
            notes: taskNotes ?? "",
        };
        const received = receivedTaskRef.current;
        receivedTaskRef.current = incoming;
        if (received && shownTaskIdRef.current === taskId) {
            const adopted = adoptChangedFields(
                received,
                incoming,
                draftRef.current,
                lastSavedRef,
                pendingTaskSavesRef.current,
            );
            if (adopted.title !== undefined) setTitleDraft(adopted.title);
            if (adopted.description !== undefined) setDescriptionDraft(adopted.description);
            if (adopted.notes !== undefined) setNotesDraft(adopted.notes);
            return;
        }
        shownTaskIdRef.current = taskId;
        pendingTaskSavesRef.current = [];
        setTitleDraft(incoming.title);
        setDescriptionDraft(incoming.description);
        setNotesDraft(incoming.notes);
        lastSavedRef.current = incoming;
    }, [taskId, taskTitle, taskDescription, taskNotes]);

    useEffect(() => {
        const incoming = {
            name: projectName ?? "",
            defaultInitCommand: projectInitCommand ?? "",
            prompt: projectPrompt ?? "",
        };
        const received = receivedProjectRef.current;
        receivedProjectRef.current = incoming;
        if (received && shownProjectIdRef.current === projectId) {
            const adopted = adoptChangedFields(
                received,
                incoming,
                projectDraftRef.current,
                lastSavedProjectRef,
                pendingProjectSavesRef.current,
            );
            if (adopted.name !== undefined) setProjectTitleDraft(adopted.name);
            if (adopted.defaultInitCommand !== undefined) {
                setProjectInitCommandDraft(adopted.defaultInitCommand);
            }
            if (adopted.prompt !== undefined) setProjectPromptDraft(adopted.prompt);
            return;
        }
        shownProjectIdRef.current = projectId;
        pendingProjectSavesRef.current = [];
        setProjectTitleDraft(incoming.name);
        setProjectInitCommandDraft(incoming.defaultInitCommand);
        setProjectPromptDraft(incoming.prompt);
        lastSavedProjectRef.current = incoming;
    }, [projectId, projectName, projectInitCommand, projectPrompt]);

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
            projectInitCommandDraft === lastSavedProjectRef.current.defaultInitCommand &&
            projectPromptDraft === lastSavedProjectRef.current.prompt
        ) {
            return;
        }

        const timeoutId = window.setTimeout(() => {
            persistProjectDrafts(
                projectId,
                projectDraftRef.current.name,
                projectDraftRef.current.defaultInitCommand,
                projectDraftRef.current.prompt,
            );
        }, 400);
        return () => window.clearTimeout(timeoutId);
    }, [
        persistProjectDrafts,
        projectId,
        projectInitCommandDraft,
        projectPromptDraft,
        projectTitleDraft,
    ]);

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
                projectDraftRef.current.prompt,
            );
        };
    }, [persistProjectDrafts, projectId]);

    // Fetch task log when task changes
    useEffect(() => {
        const target = useTaskStore.getState().tasks.find((t) => t.id === taskId);
        if (!target) return;
        void fetchTaskLog(target);
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
                            <Textarea
                                id="project-info-default-init-command"
                                value={projectInitCommandDraft}
                                onChange={(e) => setProjectInitCommandDraft(e.target.value)}
                                placeholder="bun install"
                                rows={3}
                                className="mt-1 min-h-20 resize-y text-sm"
                            />
                            <p className="text-muted-foreground mt-1 text-xs">
                                Used as the default init command when creating worktree tasks.
                            </p>
                        </div>

                        <Separator className="my-4" />

                        <div>
                            <label
                                htmlFor="project-info-prompt"
                                className="text-muted-foreground text-xs font-medium">
                                Project-specific system prompt
                            </label>
                            <ExpandableTextarea
                                id="project-info-prompt"
                                dialogTitle="Project Prompt"
                                showInfoButton={false}
                                value={projectPromptDraft}
                                onChange={(e) => setProjectPromptDraft(e.target.value)}
                                rows={4}
                                placeholder="Instructions injected into every agent session..."
                                className="mt-1 text-sm"
                            />
                        </div>

                        <Separator className="my-4" />

                        <AttributesSection
                            backendId={project.backendId}
                            owner={{ projectId: project.id }}
                            attributes={project.attributes}
                            inheritedLayers={NO_LAYERS}
                            idPrefix="project-info"
                        />

                        <Separator className="my-4" />

                        <div>
                            <span className="text-muted-foreground text-xs font-medium">Path</span>
                            <div className="text-secondary-foreground mt-1 text-sm break-all">
                                {project.path}
                            </div>
                        </div>

                        <Separator className="my-4" />

                        <LinkedProjectsSection project={project} />

                        <ProjectAgentAccountsSection project={project} />

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
                            <div className="mt-1 flex min-w-0 items-center gap-1">
                                <div className="border-border flex min-w-0 flex-1 items-center rounded-md border py-0.5 pr-1 pl-2">
                                    <TruncatedText
                                        as="div"
                                        tooltip
                                        tooltipSide="bottom"
                                        tooltipContent={task.worktree.branch}
                                        className="flex-1 text-xs">
                                        {task.worktree.branch}
                                    </TruncatedText>
                                </div>
                                <CopyButton
                                    value={task.worktree.branch}
                                    tooltip="Copy branch name"
                                    className="shrink-0"
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

                    <Separator className="my-4" />

                    <AttributesSection
                        backendId={task.backendId}
                        owner={{ taskId: task.id }}
                        attributes={task.attributes}
                        inheritedLayers={inheritedLayers}
                        idPrefix="task-info"
                    />

                    {/* Edited Files */}
                    {project && editedFiles.length > 0 && (
                        <>
                            <Separator className="my-4" />
                            <EditedFilesList
                                files={editedFiles}
                                workingDir={workspace.workingDir ?? project.path}
                                workspaceKey={workspace.workspaceKey ?? ""}
                                task={task}
                            />
                        </>
                    )}

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
