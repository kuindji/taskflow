import { useState, useCallback, useEffect, useRef } from "react";
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

interface NewTaskDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    projects: Project[];
    flows: FlowDefinition[];
    defaultProjectId?: string;
    parentId?: string | null;
    onSubmit: (data: {
        projectId: string;
        title?: string;
        description: string;
        worktree: boolean;
        parentId?: string;
        startWith?: "claude" | "codex" | "opencode" | "gemini" | "cursor" | "pi" | "kimi";
        agentOptions?: AgentLaunchOptions;
        startWithFlowId?: string;
        initCommand?: string;
    }) => void;
}

export function NewTaskDialog({
    open,
    onOpenChange,
    projects,
    flows,
    defaultProjectId,
    parentId,
    onSubmit,
}: NewTaskDialogProps) {
    const [projectId, setProjectId] = useState(defaultProjectId ?? "");
    const [description, setDescription] = useState("");
    const [title, setTitle] = useState("");
    const [worktree, setWorktree] = useState(false);
    const [initCommand, setInitCommand] = useState("");
    const [startWith, setStartWith] = useState("none");
    const [agentOptions, setAgentOptions] = useState<AgentLaunchOptions | undefined>(undefined);
    const [startWithFlowId, setStartWithFlowId] = useState("");
    const [agentOptionsOpen, setAgentOptionsOpen] = useState(false);
    const descriptionRef = useRef<HTMLTextAreaElement>(null);
    const isSubtask = !!parentId;

    useEffect(() => {
        if (open) {
            setProjectId(defaultProjectId ?? "");
        }
    }, [open, defaultProjectId]);

    const agents = useAgentAvailability();
    const claudeAvailable = isAgentAvailable(agents, "claude");
    const codexAvailable = isAgentAvailable(agents, "codex");
    const opencodeAvailable = isAgentAvailable(agents, "opencode");
    const geminiAvailable = isAgentAvailable(agents, "gemini");
    const cursorAvailable = isAgentAvailable(agents, "cursor");
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
        setWorktree(false);
        setInitCommand("");
        setStartWith("none");
        setAgentOptions(undefined);
        setStartWithFlowId("");
        setAgentOptionsOpen(false);
    }, []);

    const handleProjectChange = useCallback((nextProjectId: string) => {
        setProjectId(nextProjectId);
        setInitCommand("");
    }, []);

    const handleStartWithChange = useCallback(
        (value: string) => {
            if (value === "claude" && !claudeAvailable) return;
            if (value === "codex" && !codexAvailable) return;
            if (value === "opencode" && !opencodeAvailable) return;
            if (value === "gemini" && !geminiAvailable) return;
            if (value === "cursor" && !cursorAvailable) return;
            if (value === "pi" && !piAvailable) return;
            if (value === "kimi" && !kimiAvailable) return;
            setStartWith(value);
            if (
                value !== "claude" &&
                value !== "codex" &&
                value !== "opencode" &&
                value !== "gemini" &&
                value !== "cursor" &&
                value !== "pi" &&
                value !== "kimi"
            )
                setAgentOptions(undefined);
            if (value !== "flow") setStartWithFlowId("");
        },
        [
            claudeAvailable,
            codexAvailable,
            opencodeAvailable,
            geminiAvailable,
            cursorAvailable,
            piAvailable,
            kimiAvailable,
        ],
    );

    const handleOpenChange = useCallback(
        (nextOpen: boolean) => {
            if (!nextOpen) resetForm();
            if (nextOpen) {
                const nextProjectId = defaultProjectId ?? "";
                setProjectId(nextProjectId);
                setInitCommand("");
            }
            onOpenChange(nextOpen);
        },
        [defaultProjectId, onOpenChange, resetForm],
    );

    const hasFlowSelection = startWith !== "flow" || startWithFlowId !== "";
    const canSubmit =
        (isSubtask || projectId !== "") && description.trim() !== "" && hasFlowSelection;
    const defaultInitCommandPlaceholder = getProjectDefaultInitCommand(projectId) || "bun install";

    const handleSubmit = useCallback(() => {
        if (!canSubmit) return;
        onSubmit({
            projectId,
            title: title.trim() || undefined,
            description: description.trim(),
            worktree: isSubtask ? false : worktree,
            parentId: parentId ?? undefined,
            startWith:
                startWith === "claude" ||
                startWith === "codex" ||
                startWith === "opencode" ||
                startWith === "gemini" ||
                startWith === "cursor" ||
                startWith === "pi" ||
                startWith === "kimi"
                    ? startWith
                    : undefined,
            agentOptions,
            startWithFlowId: startWith === "flow" && startWithFlowId ? startWithFlowId : undefined,
            initCommand: worktree ? initCommand.trim() : undefined,
        });
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
        startWith,
        agentOptions,
        startWithFlowId,
        initCommand,
        onSubmit,
        resetForm,
        onOpenChange,
    ]);

    const handleKeyDown = useCallback(
        (e: React.KeyboardEvent) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && canSubmit) {
                e.preventDefault();
                handleSubmit();
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
                                    {projects.map((p) => (
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
                        <Select value={startWith} onValueChange={handleStartWithChange}>
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
                                <SelectItem value="gemini" disabled={!geminiAvailable}>
                                    Gemini{!geminiAvailable ? " (not installed)" : ""}
                                </SelectItem>
                                <SelectItem value="cursor" disabled={!cursorAvailable}>
                                    Cursor{!cursorAvailable ? " (not installed)" : ""}
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
                            <Select value={startWithFlowId} onValueChange={setStartWithFlowId}>
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

                    {(startWith === "claude" ||
                        startWith === "codex" ||
                        startWith === "opencode" ||
                        startWith === "gemini" ||
                        startWith === "cursor" ||
                        startWith === "pi" ||
                        startWith === "kimi") && (
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
                                        agentType={startWith}
                                        onChange={setAgentOptions}
                                    />
                                </div>
                            </CollapsibleContent>
                        </Collapsible>
                    )}
                </div>

                <DialogFooter>
                    <Button variant="secondary" size="sm" onClick={() => handleOpenChange(false)}>
                        Cancel
                    </Button>
                    <Button
                        size="sm"
                        onClick={handleSubmit}
                        disabled={!canSubmit}
                        className="bg-accent text-accent-foreground hover:bg-accent/90">
                        {isSubtask ? "Create Subtask" : "Create Task"}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
