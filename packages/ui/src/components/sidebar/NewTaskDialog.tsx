import { useState, useCallback, useRef } from "react";
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
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { AgentOptionsPanel } from "@/components/workspace/AgentOptionsPanel";

interface NewTaskDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    projects: Project[];
    flows: FlowDefinition[];
    defaultProjectId?: string;
    onSubmit: (data: {
        projectId: string;
        title?: string;
        description: string;
        worktree: boolean;
        startWith?: "claude" | "codex";
        agentOptions?: AgentLaunchOptions;
        startWithFlowId?: string;
    }) => void;
}

export function NewTaskDialog({
    open,
    onOpenChange,
    projects,
    flows,
    defaultProjectId,
    onSubmit,
}: NewTaskDialogProps) {
    const [projectId, setProjectId] = useState(defaultProjectId ?? "");
    const [description, setDescription] = useState("");
    const [title, setTitle] = useState("");
    const [worktree, setWorktree] = useState(false);
    const [startWith, setStartWith] = useState("none");
    const [agentOptions, setAgentOptions] = useState<AgentLaunchOptions | undefined>(undefined);
    const [startWithFlowId, setStartWithFlowId] = useState("");
    const descriptionRef = useRef<HTMLTextAreaElement>(null);

    const resetForm = useCallback(() => {
        setDescription("");
        setTitle("");
        setWorktree(false);
        setStartWith("none");
        setAgentOptions(undefined);
        setStartWithFlowId("");
    }, []);

    const handleStartWithChange = useCallback((value: string) => {
        setStartWith(value);
        if (value !== "claude" && value !== "codex") setAgentOptions(undefined);
        if (value !== "flow") setStartWithFlowId("");
    }, []);

    const handleOpenChange = useCallback(
        (nextOpen: boolean) => {
            if (!nextOpen) resetForm();
            if (nextOpen) setProjectId(defaultProjectId ?? "");
            onOpenChange(nextOpen);
        },
        [onOpenChange, resetForm, defaultProjectId],
    );

    const hasFlowSelection = startWith !== "flow" || startWithFlowId !== "";
    const canSubmit = projectId !== "" && description.trim() !== "" && hasFlowSelection;

    const handleSubmit = useCallback(() => {
        if (!canSubmit) return;
        onSubmit({
            projectId,
            title: title.trim() || undefined,
            description: description.trim(),
            worktree,
            startWith: startWith === "claude" || startWith === "codex" ? startWith : undefined,
            agentOptions,
            startWithFlowId: startWith === "flow" && startWithFlowId ? startWithFlowId : undefined,
        });
        resetForm();
        onOpenChange(false);
    }, [
        canSubmit,
        projectId,
        title,
        description,
        worktree,
        startWith,
        agentOptions,
        startWithFlowId,
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
                onOpenAutoFocus={handleOpenAutoFocus}
            >
                <DialogHeader>
                    <DialogTitle>New Task</DialogTitle>
                </DialogHeader>

                <div className="flex flex-col gap-3">
                    <div className="flex flex-col gap-1.5">
                        <Label htmlFor="new-task-project">Project</Label>
                        <Select value={projectId} onValueChange={setProjectId}>
                            <SelectTrigger id="new-task-project" className="w-full">
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

                    <div className="flex flex-col gap-1.5">
                        <Label htmlFor="new-task-description">Description</Label>
                        <Textarea
                            id="new-task-description"
                            ref={descriptionRef}
                            placeholder="Describe what this task should accomplish..."
                            value={description}
                            onChange={(e) => setDescription(e.target.value)}
                            className="max-h-40 min-h-20"
                        />
                    </div>

                    <div className="flex flex-col gap-1.5">
                        <Label htmlFor="new-task-title">
                            Title{" "}
                            <span className="text-muted-foreground/60 text-xs tracking-normal normal-case">
                                (optional — auto-generated from description)
                            </span>
                        </Label>
                        <Input
                            id="new-task-title"
                            placeholder="Short task name..."
                            value={title}
                            onChange={(e) => setTitle(e.target.value)}
                        />
                    </div>

                    <div className="flex items-center gap-2">
                        <Switch
                            id="new-task-worktree"
                            checked={worktree}
                            onCheckedChange={setWorktree}
                        />
                        <Label
                            htmlFor="new-task-worktree"
                            className="cursor-pointer tracking-normal normal-case"
                        >
                            Use git worktree
                        </Label>
                    </div>

                    <div className="flex flex-col gap-1.5">
                        <Label htmlFor="new-task-start-with">Start immediately with</Label>
                        <Select value={startWith} onValueChange={handleStartWithChange}>
                            <SelectTrigger id="new-task-start-with" className="w-full">
                                <SelectValue placeholder="Don't start" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="none">Don't start</SelectItem>
                                <SelectItem value="claude">Claude Code</SelectItem>
                                <SelectItem value="codex">Codex</SelectItem>
                                {flows.length > 0 && (
                                    <SelectItem value="flow">Flow</SelectItem>
                                )}
                            </SelectContent>
                        </Select>
                    </div>

                    {startWith === "flow" && flows.length > 0 && (
                        <div className="flex flex-col gap-1.5">
                            <Label htmlFor="new-task-flow">Flow</Label>
                            <Select value={startWithFlowId} onValueChange={setStartWithFlowId}>
                                <SelectTrigger id="new-task-flow" className="w-full">
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
                            <p className="text-muted-foreground text-xs">
                                Select a flow to start immediately after task creation.
                            </p>
                        </div>
                    )}

                    {(startWith === "claude" || startWith === "codex") && (
                        <div className="border-border rounded-md border p-1">
                            <AgentOptionsPanel agentType={startWith} onChange={setAgentOptions} />
                        </div>
                    )}
                </div>

                <DialogFooter>
                    <Button variant="secondary" onClick={() => handleOpenChange(false)}>
                        Cancel
                    </Button>
                    <Button
                        onClick={handleSubmit}
                        disabled={!canSubmit}
                        className="bg-accent text-accent-foreground hover:bg-accent/90"
                    >
                        Create Task
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
