import { useState, useCallback } from "react";
import type { Project } from "@taskflow/shared";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
    DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";

interface RemoveProjectDialogProps {
    open: boolean;
    project: Project;
    onOpenChange: (open: boolean) => void;
    onRemove: (projectId: string) => void;
    onHide: (projectId: string) => void;
}

export function RemoveProjectDialog({
    open,
    project,
    onOpenChange,
    onRemove,
    onHide,
}: RemoveProjectDialogProps) {
    const [keepData, setKeepData] = useState(true);

    const handleConfirm = useCallback(() => {
        if (keepData) {
            onHide(project.id);
        } else {
            onRemove(project.id);
        }
        onOpenChange(false);
    }, [keepData, project.id, onRemove, onHide, onOpenChange]);

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle>Remove project</DialogTitle>
                    <DialogDescription>
                        {keepData
                            ? `Hide "${project.name}" from the sidebar? You can restore it by adding the same path again.`
                            : `Permanently remove "${project.name}" and delete all of its tasks? This cannot be undone.`}
                    </DialogDescription>
                </DialogHeader>

                <div className="flex items-center gap-2">
                    <Switch
                        id="keep-project-data"
                        checked={keepData}
                        onCheckedChange={setKeepData}
                    />
                    <Label htmlFor="keep-project-data" className="cursor-pointer">
                        Keep project data
                    </Label>
                </div>

                <DialogFooter>
                    <Button variant="secondary" onClick={() => onOpenChange(false)}>
                        Cancel
                    </Button>
                    <Button
                        variant={keepData ? "default" : "destructive"}
                        onClick={handleConfirm}
                    >
                        {keepData ? "Hide" : "Remove"}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
