import { useState, useCallback } from "react";
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

interface NewTaskDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    projects: Project[];
    defaultProjectId?: string;
    onSubmit: (data: {
        projectId: string;
        title?: string;
        description: string;
        worktree: boolean;
    }) => void;
}

export function NewTaskDialog({
    open,
    onOpenChange,
    projects,
    defaultProjectId,
    onSubmit,
}: NewTaskDialogProps) {
    const [projectId, setProjectId] = useState(defaultProjectId ?? "");
    const [description, setDescription] = useState("");
    const [title, setTitle] = useState("");
    const [worktree, setWorktree] = useState(false);

    const resetForm = useCallback(() => {
        setDescription("");
        setTitle("");
        setWorktree(false);
    }, []);

    const handleOpenChange = useCallback(
        (nextOpen: boolean) => {
            if (!nextOpen) resetForm();
            if (nextOpen) setProjectId(defaultProjectId ?? "");
            onOpenChange(nextOpen);
        },
        [onOpenChange, resetForm, defaultProjectId],
    );

    const canSubmit = projectId !== "" && description.trim() !== "";

    const handleSubmit = useCallback(() => {
        if (!canSubmit) return;
        onSubmit({
            projectId,
            title: title.trim() || undefined,
            description: description.trim(),
            worktree,
        });
        resetForm();
        onOpenChange(false);
    }, [canSubmit, projectId, title, description, worktree, onSubmit, resetForm, onOpenChange]);

    const handleKeyDown = useCallback(
        (e: React.KeyboardEvent) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && canSubmit) {
                e.preventDefault();
                handleSubmit();
            }
        },
        [canSubmit, handleSubmit],
    );

    return (
        <Dialog open={open} onOpenChange={handleOpenChange}>
            <DialogContent className="sm:max-w-md" onKeyDown={handleKeyDown}>
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
                            placeholder="Describe what this task should accomplish..."
                            value={description}
                            onChange={(e) => setDescription(e.target.value)}
                            className="max-h-40 min-h-20"
                        />
                    </div>

                    <div className="flex flex-col gap-1.5">
                        <Label htmlFor="new-task-title">
                            Title{" "}
                            <span className="text-muted-foreground/60 text-[10px] tracking-normal normal-case">
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
