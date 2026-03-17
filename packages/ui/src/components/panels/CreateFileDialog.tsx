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

interface CreateFileDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    directoryPath: string;
    mode: "file" | "directory";
}

function CreateFileDialog({ open, onOpenChange, directoryPath, mode }: CreateFileDialogProps) {
    const [name, setName] = useState("");
    const [error, setError] = useState<string | null>(null);
    const [submitting, setSubmitting] = useState(false);
    const inputRef = useRef<HTMLInputElement>(null);
    const createFile = useFileStore((s) => s.createFile);
    const createDirectory = useFileStore((s) => s.createDirectory);
    const expandToPathAndLoad = useFileStore((s) => s.expandToPathAndLoad);

    useEffect(() => {
        if (open) {
            setName("");
            setError(null);
            setSubmitting(false);
            requestAnimationFrame(() => {
                inputRef.current?.focus();
            });
        }
    }, [open]);

    const validate = useCallback((value: string): string | null => {
        const trimmed = value.trim();
        if (!trimmed) return "Name cannot be empty";
        if (trimmed.includes("/") || trimmed.includes("\0"))
            return "Name contains invalid characters";
        return null;
    }, []);

    const handleSubmit = async () => {
        const trimmed = name.trim();
        const validationError = validate(trimmed);
        if (validationError) {
            setError(validationError);
            return;
        }
        setSubmitting(true);
        setError(null);
        const fullPath = directoryPath + "/" + trimmed;
        try {
            if (mode === "file") {
                await createFile(fullPath);
            } else {
                await createDirectory(fullPath);
            }
            void expandToPathAndLoad(directoryPath);
            onOpenChange(false);
        } catch (e) {
            setError(e instanceof Error ? e.message : "Creation failed");
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

    const label = mode === "file" ? "New File" : "New Folder";

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent showCloseButton={false} className="sm:max-w-sm">
                <DialogHeader>
                    <DialogTitle>{label}</DialogTitle>
                    <DialogDescription className="sr-only">
                        Enter a name for the new {mode === "file" ? "file" : "folder"}
                    </DialogDescription>
                </DialogHeader>
                <div className="grid gap-2">
                    <Input
                        ref={inputRef}
                        value={name}
                        placeholder={mode === "file" ? "filename.ext" : "folder-name"}
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
                    <Button
                        variant="outline"
                        onClick={() => onOpenChange(false)}
                        disabled={submitting}
                    >
                        Cancel
                    </Button>
                    <Button onClick={() => void handleSubmit()} disabled={submitting}>
                        Create
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

export { CreateFileDialog };
