import { useState, useCallback, useEffect, useRef } from "react";
import type { Project } from "@taskflow/shared";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { useProjectStore } from "@/stores/project-store";
import { alert } from "@/stores/dialog-store";

interface ForkProjectDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    project: Project;
}

function slugify(branch: string): string {
    return branch
        .toLowerCase()
        .replace(/[/ ]/g, "-")
        .replace(/[^a-z0-9\-.]/g, "");
}

function getParentDir(path: string): string {
    const parts = path.split("/");
    parts.pop();
    return parts.join("/");
}

export function ForkProjectDialog({ open, onOpenChange, project }: ForkProjectDialogProps) {
    const [branch, setBranch] = useState("");
    const [folder, setFolder] = useState("");
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const customFolder = useRef(false);
    const branchInputRef = useRef<HTMLInputElement>(null);
    const forkProject = useProjectStore((s) => s.forkProject);

    const parentDir = getParentDir(project.path);
    const targetPath = folder ? `${parentDir}/${folder}` : "";

    useEffect(() => {
        if (open) {
            setBranch("");
            setFolder("");
            setError(null);
            setLoading(false);
            customFolder.current = false;
            const timer = setTimeout(() => branchInputRef.current?.focus(), 50);
            return () => clearTimeout(timer);
        }
    }, [open]);

    const handleBranchChange = useCallback((value: string) => {
        setBranch(value);
        setError(null);
        if (!customFolder.current) {
            setFolder(slugify(value));
        }
    }, []);

    const handleFolderChange = useCallback((value: string) => {
        customFolder.current = true;
        setFolder(value);
        setError(null);
    }, []);

    const canSubmit = branch.trim() !== "" && folder.trim() !== "" && !loading;

    const handleSubmit = useCallback(async () => {
        if (!canSubmit) return;
        setLoading(true);
        setError(null);
        try {
            const response = await forkProject(project.id, branch.trim(), folder.trim());
            onOpenChange(false);
            void alert({
                title: "Project forked",
                description: `Branch "${response.branch}" created in ${response.targetPath} and added as a new project.`,
            });
        } catch (err) {
            setError(err instanceof Error ? err.message : "Fork failed");
        } finally {
            setLoading(false);
        }
    }, [canSubmit, forkProject, project.id, branch, folder, onOpenChange]);

    const handleKeyDown = useCallback(
        (e: React.KeyboardEvent) => {
            if (e.key === "Enter" && canSubmit) {
                e.preventDefault();
                void handleSubmit();
            }
        },
        [canSubmit, handleSubmit],
    );

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-md" onKeyDown={handleKeyDown}>
                <DialogHeader>
                    <DialogTitle>Fork Project</DialogTitle>
                </DialogHeader>

                <div className="flex flex-col gap-4">
                    <div className="flex flex-col gap-1.5">
                        <Label htmlFor="fork-branch-name">Branch name</Label>
                        <Input
                            ref={branchInputRef}
                            id="fork-branch-name"
                            value={branch}
                            onChange={(e) => handleBranchChange(e.target.value)}
                            placeholder="feature/my-branch"
                        />
                    </div>

                    <div className="flex flex-col gap-1.5">
                        <Label htmlFor="fork-folder-name">
                            Folder name{" "}
                            <span className="text-muted-foreground font-normal">(optional)</span>
                        </Label>
                        <Input
                            id="fork-folder-name"
                            value={folder}
                            onChange={(e) => handleFolderChange(e.target.value)}
                            placeholder={slugify(branch) || "derived-from-branch"}
                        />
                        {targetPath && (
                            <p className="text-muted-foreground text-xs">
                                Will be created at: {targetPath}
                            </p>
                        )}
                    </div>

                    {error && (
                        <p className="text-destructive text-sm">{error}</p>
                    )}
                </div>

                <DialogFooter>
                    <Button variant="secondary" onClick={() => onOpenChange(false)}>
                        Cancel
                    </Button>
                    <Button
                        onClick={() => void handleSubmit()}
                        disabled={!canSubmit}
                        loading={loading}
                        className="bg-accent text-accent-foreground hover:bg-accent/90"
                    >
                        Fork
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
