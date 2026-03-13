import { useState, useCallback } from "react";
import type { Project } from "@taskflow/shared";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogFooter,
    DialogDescription,
} from "@/components/ui/dialog";
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { FolderOpen } from "lucide-react";
import { useProjectStore } from "@/stores/project-store";

interface MissingLocationDialogProps {
    project: Project | null;
    open: boolean;
    onOpenChange: (open: boolean) => void;
}

export function MissingLocationDialog({
    project,
    open,
    onOpenChange,
}: MissingLocationDialogProps) {
    const updateProject = useProjectStore((s) => s.updateProject);
    const removeProject = useProjectStore((s) => s.removeProject);
    const [confirmRemoveOpen, setConfirmRemoveOpen] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const handleChangeLocation = useCallback(async () => {
        if (!project) return;
        setError(null);
        const selected = await window.taskflow?.selectProjectDirectory();
        if (!selected) return;
        try {
            await updateProject(project.id, { path: selected });
            onOpenChange(false);
        } catch (err) {
            setError(err instanceof Error ? err.message : "Failed to update project location");
        }
    }, [project, updateProject, onOpenChange]);

    const handleRemove = useCallback(async () => {
        if (!project) return;
        await removeProject(project.id);
        setConfirmRemoveOpen(false);
        onOpenChange(false);
    }, [project, removeProject, onOpenChange]);

    if (!project) return null;

    return (
        <>
            <Dialog open={open} onOpenChange={onOpenChange}>
                <DialogContent className="sm:max-w-md">
                    <DialogHeader>
                        <DialogTitle>Project Location Not Found</DialogTitle>
                        <DialogDescription>
                            The directory for <strong>{project.name}</strong> was not found at:
                        </DialogDescription>
                    </DialogHeader>

                    <code className="bg-muted text-muted-foreground rounded px-2 py-1 text-xs break-all">
                        {project.path}
                    </code>

                    {error && <p className="text-destructive text-xs">{error}</p>}

                    <DialogFooter>
                        <Button
                            variant="destructive"
                            onClick={() => setConfirmRemoveOpen(true)}
                        >
                            Remove Project
                        </Button>
                        <Button
                            onClick={() => void handleChangeLocation()}
                            className="bg-accent text-accent-foreground hover:bg-accent/90 gap-2"
                        >
                            <FolderOpen className="h-4 w-4" />
                            Change Location
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <AlertDialog open={confirmRemoveOpen} onOpenChange={setConfirmRemoveOpen}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Remove Project?</AlertDialogTitle>
                        <AlertDialogDescription>
                            This will remove <strong>{project.name}</strong> and delete all its
                            tasks. This action cannot be undone.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                            onClick={() => void handleRemove()}
                            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                        >
                            Remove
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </>
    );
}
