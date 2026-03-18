import { useState, useCallback, useEffect, useRef } from "react";
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

interface RenameProjectDialogProps {
    open: boolean;
    currentName: string;
    onOpenChange: (open: boolean) => void;
    onSubmit: (name: string) => void;
}

export function RenameProjectDialog({
    open,
    currentName,
    onOpenChange,
    onSubmit,
}: RenameProjectDialogProps) {
    const [name, setName] = useState(currentName);
    const inputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        if (open) {
            setName(currentName);
        }
    }, [open, currentName]);

    useEffect(() => {
        if (open) {
            // Delay to let dialog animate in before selecting
            const timer = setTimeout(() => inputRef.current?.select(), 50);
            return () => clearTimeout(timer);
        }
    }, [open]);

    const canSubmit = name.trim() !== "" && name.trim() !== currentName;

    const handleSubmit = useCallback(() => {
        if (!canSubmit) return;
        onSubmit(name.trim());
        onOpenChange(false);
    }, [canSubmit, name, onSubmit, onOpenChange]);

    const handleKeyDown = useCallback(
        (e: React.KeyboardEvent) => {
            if (e.key === "Enter" && canSubmit) {
                e.preventDefault();
                handleSubmit();
            }
        },
        [canSubmit, handleSubmit],
    );

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-md" onKeyDown={handleKeyDown}>
                <DialogHeader>
                    <DialogTitle>Rename Project</DialogTitle>
                </DialogHeader>

                <div className="flex flex-col gap-1.5">
                    <Label htmlFor="rename-project-name">Name</Label>
                    <Input
                        ref={inputRef}
                        id="rename-project-name"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                    />
                </div>

                <DialogFooter>
                    <Button variant="secondary" onClick={() => onOpenChange(false)}>
                        Cancel
                    </Button>
                    <Button
                        onClick={handleSubmit}
                        disabled={!canSubmit}
                        className="bg-accent text-accent-foreground hover:bg-accent/90">
                        Rename
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
