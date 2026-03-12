import { useState, useEffect, useRef, useCallback } from "react";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogFooter,
    DialogDescription,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useFileStore } from "@/stores/file-store";

interface RenameFileDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    filePath: string;
    isDirectory: boolean;
}

function RenameFileDialog({ open, onOpenChange, filePath, isDirectory }: RenameFileDialogProps) {
    const currentName = filePath.split("/").pop() ?? "";
    const parentDir = filePath.slice(0, filePath.length - currentName.length);
    const [name, setName] = useState(currentName);
    const [error, setError] = useState<string | null>(null);
    const [submitting, setSubmitting] = useState(false);
    const inputRef = useRef<HTMLInputElement>(null);
    const renameFile = useFileStore((s) => s.renameFile);

    useEffect(() => {
        if (open) {
            setName(currentName);
            setError(null);
            setSubmitting(false);
            requestAnimationFrame(() => {
                const input = inputRef.current;
                if (!input) return;
                input.focus();
                if (!isDirectory) {
                    const dotIndex = currentName.lastIndexOf(".");
                    input.setSelectionRange(0, dotIndex > 0 ? dotIndex : currentName.length);
                } else {
                    input.select();
                }
            });
        }
    }, [open, currentName, isDirectory]);

    const validate = useCallback((value: string): string | null => {
        const trimmed = value.trim();
        if (!trimmed) return "Name cannot be empty";
        if (trimmed.includes("/") || trimmed.includes("\0")) return "Name contains invalid characters";
        return null;
    }, []);

    const handleSubmit = async () => {
        const trimmed = name.trim();
        const validationError = validate(trimmed);
        if (validationError) {
            setError(validationError);
            return;
        }
        if (trimmed === currentName) {
            onOpenChange(false);
            return;
        }
        setSubmitting(true);
        setError(null);
        try {
            await renameFile(filePath, parentDir + trimmed);
            onOpenChange(false);
        } catch (e) {
            setError(e instanceof Error ? e.message : "Rename failed");
        } finally {
            setSubmitting(false);
        }
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === "Enter") {
            e.preventDefault();
            void handleSubmit();
        }
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent showCloseButton={false} className="sm:max-w-sm">
                <DialogHeader>
                    <DialogTitle>Rename</DialogTitle>
                    <DialogDescription className="sr-only">
                        Enter a new name for this {isDirectory ? "folder" : "file"}
                    </DialogDescription>
                </DialogHeader>
                <div className="grid gap-2">
                    <Input
                        ref={inputRef}
                        value={name}
                        onChange={(e) => {
                            setName(e.target.value);
                            setError(null);
                        }}
                        onKeyDown={handleKeyDown}
                        disabled={submitting}
                    />
                    {error && <p className="text-destructive text-sm">{error}</p>}
                </div>
                <DialogFooter>
                    <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
                        Cancel
                    </Button>
                    <Button onClick={() => void handleSubmit()} disabled={submitting}>
                        Rename
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

export { RenameFileDialog };
