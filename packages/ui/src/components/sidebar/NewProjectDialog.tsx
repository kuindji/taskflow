import { useState, useCallback } from "react";
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
import { FolderOpen } from "lucide-react";
import { usePrimaryBackend } from "@/hooks/usePrimaryBackend";
import { useLocalOnlyHint } from "@/hooks/useIsLocalBackend";

interface NewProjectDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onSubmit: (path: string) => void;
    error?: string | null;
}

export function NewProjectDialog({ open, onOpenChange, onSubmit, error }: NewProjectDialogProps) {
    const [path, setPath] = useState("");

    const hasElectronPicker = typeof window.taskflow?.selectProjectDirectory === "function";
    // A new project is added to primary; the picker lists this machine's folders.
    const localOnlyHint = useLocalOnlyHint(usePrimaryBackend());

    const resetForm = useCallback(() => {
        setPath("");
    }, []);

    const handleOpenChange = useCallback(
        (nextOpen: boolean) => {
            if (!nextOpen) resetForm();
            onOpenChange(nextOpen);
        },
        [onOpenChange, resetForm],
    );

    const canSubmit = path.trim() !== "";

    const handleSubmit = useCallback(() => {
        if (!canSubmit) return;
        onSubmit(path.trim());
    }, [canSubmit, path, onSubmit]);

    const handleBrowse = useCallback(async () => {
        if (localOnlyHint) return;
        const selected = await window.taskflow?.selectProjectDirectory();
        if (selected) setPath(selected);
    }, [localOnlyHint]);

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
                    <DialogTitle>Add Project</DialogTitle>
                </DialogHeader>

                <div className="flex flex-col gap-3">
                    <div className="flex flex-col gap-1.5">
                        <Label htmlFor="new-project-path">Directory</Label>
                        {hasElectronPicker ? (
                            // A disabled button takes no pointer events, so the wrapper carries the tooltip.
                            <span title={localOnlyHint ?? undefined} className="flex flex-col">
                                <Button
                                    variant="outline"
                                    onClick={handleBrowse}
                                    disabled={localOnlyHint !== null}
                                    className="justify-start gap-2 font-normal">
                                    <FolderOpen className="h-4 w-4 shrink-0" />
                                    <span className="truncate text-left">
                                        {path || "Select a directory..."}
                                    </span>
                                </Button>
                            </span>
                        ) : (
                            <Input
                                id="new-project-path"
                                placeholder="/path/to/project"
                                value={path}
                                onChange={(e) => setPath(e.target.value)}
                            />
                        )}
                    </div>

                    {error && <p className="text-destructive text-xs">{error}</p>}
                </div>

                <DialogFooter>
                    <Button variant="secondary" onClick={() => handleOpenChange(false)}>
                        Cancel
                    </Button>
                    <Button
                        onClick={handleSubmit}
                        disabled={!canSubmit}
                        className="bg-accent text-accent-foreground hover:bg-accent/90">
                        Add Project
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
