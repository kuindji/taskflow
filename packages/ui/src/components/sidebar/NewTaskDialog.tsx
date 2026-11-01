import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import type { Scoped } from "@/lib/backend-scope";
import { DEFAULT_AGENT_ACCOUNT_ID, isAgentType } from "@taskflow/shared";
import type { AgentLaunchOptions, FlowDefinition } from "@taskflow/shared";
import type { Project } from "@taskflow/shared";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogFooter,
} from "@/components/ui/dialog";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { ExpandableTextarea } from "@/components/ui/expandable-textarea";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from "@/components/ui/collapsible";
import { ChevronRight, Info } from "lucide-react";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { AgentOptionsPanel } from "@/components/workspace/AgentOptionsPanel";
import { useAgentAvailability, isAgentAvailable } from "@/hooks/useAgentAvailability";
import type { DroppedTask } from "@/lib/dropped-task";
import { activeProjects, selectableProjectId } from "@/lib/project-visibility";
import { settingsFor } from "@/stores/settings-store";

export interface NewTaskSubmission {
    projectId: string;
    title?: string;
    description: string;
    worktree: boolean;
    parentId?: string;
    startWith?: "claude" | "codex" | "opencode" | "pi" | "kimi";
    agentOptions?: AgentLaunchOptions;
    startWithFlowId?: string;
    initCommand?: string;
}

interface NewTaskDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    projects: Scoped<Project>[];
    /** The flows a task in this project can start with; a subtask's are its parent's. */
    flowsFor: (projectId: string) => FlowDefinition[];
    defaultProjectId?: string;
    parentId?: string | null;
    /** Fields to open with, when the dialog was opened by a drop. */
    prefill?: DroppedTask | null;
    /** Settles once the task exists; a rejection keeps the dialog open with its form. */
    onSubmit: (data: NewTaskSubmission) => Promise<void>;
}

/**
 * The options with their account dropped unless the machine knows it: an
 * account is the machine's own, and the launch fails on a machine without it.
 */
function withMachineAccount(
    options: AgentLaunchOptions | undefined,
    backendId: string | undefined,
): AgentLaunchOptions | undefined {
    if (options?.type !== "claude" && options?.type !== "codex") return options;
    const ref = options.account;
    if (ref === undefined || ref === DEFAULT_AGENT_ACCOUNT_ID) return options;
    const accounts = backendId ? settingsFor(backendId)?.[options.type].accounts : undefined;
    return accounts?.some((account) => account.id === ref || account.name === ref)
        ? options
        : { ...options, account: undefined };
}

export function NewTaskDialog({
    open,
    onOpenChange,
    projects,
    flowsFor,
    defaultProjectId,
    parentId,
    prefill,
    onSubmit,
}: NewTaskDialogProps) {
    const isSubtask = !!parentId;
    const defaultSelection = isSubtask
        ? defaultProjectId
        : selectableProjectId(projects, defaultProjectId);
    const projectOptions = useMemo(() => activeProjects(projects), [projects]);
    const [projectId, setProjectId] = useState(defaultSelection ?? "");
    const [description, setDescription] = useState("");
    const [title, setTitle] = useState("");
    const [worktree, setWorktree] = useState(true);
    const [initCommand, setInitCommand] = useState("");
    const [startWith, setStartWith] = useState("none");
    const [agentOptions, setAgentOptions] = useState<AgentLaunchOptions | undefined>(undefined);
    const [startWithFlowId, setStartWithFlowId] = useState("");
    const [agentOptionsOpen, setAgentOptionsOpen] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const [submitError, setSubmitError] = useState<string | null>(null);
    const submission = useRef(0);
    const descriptionRef = useRef<HTMLTextAreaElement>(null);

    // Seeded on the false -> true edge only, and never afterwards.
    //
    // `handleOpenChange` cannot do this: it runs only when Radix drives the
    // dialog, and a drop opens it by flipping the store, which changes `open`
    // without that handler firing. Keying off the edge rather than off `open`
    // also means a re-render carrying an equal-but-new `prefill` object cannot
    // overwrite what the user has since typed.
    //
    // The project is seeded on that edge too. While the form is open a later
    // default (the active task moved, say by an earlier create settling) must
    // not move a project already chosen; it only fills an empty picker, such
    // as one opened before the projects arrived.
    const wasOpen = useRef(false);
    useEffect(() => {
        if (open && wasOpen.current && defaultSelection) {
            setProjectId((current) => current || defaultSelection);
        }
        if (open && !wasOpen.current) {
            setProjectId(defaultSelection ?? "");
            if (prefill?.title !== undefined) setTitle(prefill.title);
            if (prefill?.description !== undefined) setDescription(prefill.description);
        }
        if (!open && wasOpen.current) {
            // A create still in flight now belongs to a closed form: its
            // reply must not close or clear the next draft.
            submission.current += 1;
            setSubmitting(false);
        }
        wasOpen.current = open;
    }, [open, prefill, defaultSelection]);

    // The machine the task will run on: its installed agents are the ones on offer.
    const agents = useAgentAvailability(
        projects.find((project) => project.id === projectId)?.backendId ?? null,
    );
    const claudeAvailable = isAgentAvailable(agents, "claude");
    const codexAvailable = isAgentAvailable(agents, "codex");
    const opencodeAvailable = isAgentAvailable(agents, "opencode");
    const piAvailable = isAgentAvailable(agents, "pi");
    const kimiAvailable = isAgentAvailable(agents, "kimi");

    const getProjectDefaultInitCommand = useCallback(
        (targetProjectId: string) =>
            projects.find((project) => project.id === targetProjectId)?.defaultInitCommand ?? "",
        [projects],
    );

    const resetForm = useCallback(() => {
        setDescription("");
        setTitle("");
        setWorktree(true);
        setInitCommand("");
        setStartWith("none");
        setAgentOptions(undefined);
        setStartWithFlowId("");
        setAgentOptionsOpen(false);
        setSubmitError(null);
    }, []);

    const handleProjectChange = useCallback(
        (nextProjectId: string) => {
            const backendOf = (id: string) => projects.find((p) => p.id === id)?.backendId;
            const nextBackendId = backendOf(nextProjectId);
            if (nextBackendId !== backendOf(projectId)) {
                setAgentOptions((current) => withMachineAccount(current, nextBackendId));
            }
            setProjectId(nextProjectId);
            setInitCommand("");
        },
        [projects, projectId],
    );

    const handleStartWithChange = useCallback(
        (value: string) => {
            if (isAgentType(value) && !isAgentAvailable(agents, value)) return;
            setStartWith(value);
            if (!isAgentType(value)) setAgentOptions(undefined);
            if (value !== "flow") setStartWithFlowId("");
        },
        [agents],
    );

    const handleOpenChange = useCallback(
        (nextOpen: boolean) => {
            if (!nextOpen) resetForm();
            if (nextOpen) {
                const nextProjectId = defaultSelection ?? "";
                setProjectId(nextProjectId);
                setInitCommand("");
            }
            onOpenChange(nextOpen);
        },
        [defaultSelection, onOpenChange, resetForm],
    );

    const flows = useMemo(() => flowsFor(projectId), [flowsFor, projectId]);
    // Changing the project can take the chosen flow, or every flow, out of
    // reach, or move the task to a machine without the chosen agent.
    const flowId = flows.some((f) => f.id === startWithFlowId) ? startWithFlowId : "";
    const startWithChoice =
        (startWith === "flow" && flows.length === 0) ||
        (isAgentType(startWith) && !isAgentAvailable(agents, startWith))
            ? "none"
            : startWith;
    const hasFlowSelection = startWithChoice !== "flow" || flowId !== "";
    const canSubmit =
        !submitting &&
        (isSubtask || projectId !== "") &&
        description.trim() !== "" &&
        hasFlowSelection;
    const defaultInitCommandPlaceholder = getProjectDefaultInitCommand(projectId) || "bun install";

    const handleSubmit = useCallback(async () => {
        if (!canSubmit) return;
        const current = ++submission.current;
        setSubmitting(true);
        setSubmitError(null);
        try {
            await onSubmit({
                projectId,
                title: title.trim() || undefined,
                description: description.trim(),
                worktree: isSubtask ? false : worktree,
                parentId: parentId ?? undefined,
                startWith: isAgentType(startWithChoice) ? startWithChoice : undefined,
                agentOptions: isAgentType(startWithChoice) ? agentOptions : undefined,
                startWithFlowId: startWithChoice === "flow" && flowId ? flowId : undefined,
                initCommand: worktree ? initCommand.trim() : undefined,
            });
        } catch (err) {
            // The draft stays for a retry once the machine answers again.
            if (current === submission.current) {
                setSubmitError(err instanceof Error ? err.message : "Failed to create task");
                setSubmitting(false);
            }
            return;
        }
        if (current !== submission.current) return;
        setSubmitting(false);
        resetForm();
        onOpenChange(false);
    }, [
        canSubmit,
        projectId,
        title,
        description,
        worktree,
        isSubtask,
        parentId,
        agentOptions,
        startWithChoice,
        flowId,
        initCommand,
        onSubmit,
        resetForm,
        onOpenChange,
    ]);

    const handleKeyDown = useCallback(
        (e: React.KeyboardEvent) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && canSubmit) {
                e.preventDefault();
                void handleSubmit();
            }
        },
        [canSubmit, handleSubmit],
    );

    const handleOpenAutoFocus = useCallback((e: Event) => {
        e.preventDefault();
        descriptionRef.current?.focus();
    }, []);

    return (
        <Dialog open={open} onOpenChange={handleOpenChange}>
            <DialogContent
                className="sm:max-w-md"
                onKeyDown={handleKeyDown}
                onOpenAutoFocus={handleOpenAutoFocus}>
                <DialogHeader>
                    <DialogTitle>{isSubtask ? "New Subtask" : "New Task"}</DialogTitle>
                </DialogHeader>

                <div className="flex max-h-[60vh] flex-col gap-3 overflow-y-auto pr-1">
                    {!isSubtask && (
                        <div className="flex flex-col gap-1.5">
                            <Label htmlFor="new-task-project">Project</Label>
                            <Select value={projectId} onValueChange={handleProjectChange}>
                                <SelectTrigger id="new-task-project" size="sm" className="w-full">
                                    <SelectValue placeholder="Select a project" />
                                </SelectTrigger>
                                <SelectContent>
                                    {projectOptions.map((p) => (
                                        <SelectItem key={p.id} value={p.id}>
                                            {p.name}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                    )}

                    <div className="flex flex-col gap-1.5">
                        <Label htmlFor="new-task-description">Description</Label>
                        <ExpandableTextarea
                            id="new-task-description"
                            ref={descriptionRef}
                            placeholder="Describe what this task should accomplish..."
                            value={description}
                            onChange={(e) => setDescription(e.target.value)}
                            className="max-h-40 min-h-20"
                            dialogTitle="Task Description"
                        />
                    </div>

                    <div className="flex flex-col gap-1.5">
                        <div className="flex items-center gap-1.5">
                            <Label htmlFor="new-task-title">Title</Label>
                            <Tooltip>
                                <TooltipTrigger>
                                    <Info className="text-muted-foreground h-3 w-3 shrink-0" />
                                </TooltipTrigger>
                                <TooltipContent side="top">
                                    Optional — auto-generated from description
                                </TooltipContent>
                            </Tooltip>
                        </div>
                        <Input
                            id="new-task-title"
                            size="sm"
                            placeholder="Short task name..."
                            value={title}
                            onChange={(e) => setTitle(e.target.value)}
                        />
                    </div>

                    {!isSubtask && (
                        <div className="flex items-center gap-2">
                            <Switch
                                id="new-task-worktree"
                                checked={worktree}
                                onCheckedChange={setWorktree}
                            />
                            <Label
                                htmlFor="new-task-worktree"
                                className="cursor-pointer tracking-normal normal-case">
                                Use git worktree
                            </Label>
                        </div>
                    )}

                    {!isSubtask && worktree && (
                        <div className="flex flex-col gap-1.5">
                            <div className="flex items-center gap-1.5">
                                <Label htmlFor="new-task-init-command">Init command</Label>
                                <Tooltip>
                                    <TooltipTrigger>
                                        <Info className="text-muted-foreground h-3 w-3 shrink-0" />
                                    </TooltipTrigger>
                                    <TooltipContent side="top">
                                        Optional — project default runs when empty
                                    </TooltipContent>
                                </Tooltip>
                            </div>
                            <Input
                                id="new-task-init-command"
                                size="sm"
                                placeholder={defaultInitCommandPlaceholder}
                                value={initCommand}
                                onChange={(e) => setInitCommand(e.target.value)}
                            />
                        </div>
                    )}

                    <div className="flex flex-col gap-1.5">
                        <Label htmlFor="new-task-start-with">Start immediately with</Label>
                        <Select value={startWithChoice} onValueChange={handleStartWithChange}>
                            <SelectTrigger id="new-task-start-with" size="sm" className="w-full">
                                <SelectValue placeholder="Don't start" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="none">Don't start</SelectItem>
                                <SelectItem value="claude" disabled={!claudeAvailable}>
                                    Claude Code{!claudeAvailable ? " (not installed)" : ""}
                                </SelectItem>
                                <SelectItem value="codex" disabled={!codexAvailable}>
                                    Codex{!codexAvailable ? " (not installed)" : ""}
                                </SelectItem>
                                <SelectItem value="opencode" disabled={!opencodeAvailable}>
                                    OpenCode{!opencodeAvailable ? " (not installed)" : ""}
                                </SelectItem>
                                <SelectItem value="pi" disabled={!piAvailable}>
                                    Pi{!piAvailable ? " (not installed)" : ""}
                                </SelectItem>
                                <SelectItem value="kimi" disabled={!kimiAvailable}>
                                    Kimi{!kimiAvailable ? " (not installed)" : ""}
                                </SelectItem>
                                {flows.length > 0 && <SelectItem value="flow">Flow</SelectItem>}
                            </SelectContent>
                        </Select>
                    </div>

                    {startWith === "flow" && flows.length > 0 && (
                        <div className="flex flex-col gap-1.5">
                            <div className="flex items-center gap-1.5">
                                <Label htmlFor="new-task-flow">Flow</Label>
                                <Tooltip>
                                    <TooltipTrigger>
                                        <Info className="text-muted-foreground h-3 w-3 shrink-0" />
                                    </TooltipTrigger>
                                    <TooltipContent side="top">
                                        Starts immediately after task creation
                                    </TooltipContent>
                                </Tooltip>
                            </div>
                            <Select value={flowId} onValueChange={setStartWithFlowId}>
                                <SelectTrigger id="new-task-flow" size="sm" className="w-full">
                                    <SelectValue placeholder="Select a flow" />
                                </SelectTrigger>
                                <SelectContent>
                                    {flows.map((f) => (
                                        <SelectItem key={f.id} value={f.id}>
                                            {f.name}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                    )}

                    {isAgentType(startWithChoice) && (
                        <Collapsible open={agentOptionsOpen} onOpenChange={setAgentOptionsOpen}>
                            <CollapsibleTrigger className="text-muted-foreground hover:text-foreground flex w-full items-center gap-1 text-sm transition-colors">
                                <ChevronRight
                                    className={`h-4 w-4 transition-transform ${agentOptionsOpen ? "rotate-90" : ""}`}
                                />
                                Agent Options
                            </CollapsibleTrigger>
                            <CollapsibleContent>
                                <div className="border-border mt-1.5 rounded-md border p-3">
                                    <AgentOptionsPanel
                                        projectId={projectId}
                                        backendId={
                                            projects.find((p) => p.id === projectId)?.backendId
                                        }
                                        agentType={startWithChoice}
                                        value={agentOptions}
                                        onChange={setAgentOptions}
                                    />
                                </div>
                            </CollapsibleContent>
                        </Collapsible>
                    )}
                </div>

                {submitError && <p className="text-destructive text-xs">{submitError}</p>}

                <DialogFooter>
                    <Button variant="secondary" size="sm" onClick={() => handleOpenChange(false)}>
                        Cancel
                    </Button>
                    <Button
                        size="sm"
                        onClick={() => void handleSubmit()}
                        disabled={!canSubmit}
                        className="bg-accent text-accent-foreground hover:bg-accent/90">
                        {isSubtask ? "Create Subtask" : "Create Task"}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
