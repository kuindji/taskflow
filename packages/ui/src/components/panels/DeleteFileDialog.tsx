import { useEffect, useState } from "react";
import {
    AlertDialog,
    AlertDialogContent,
    AlertDialogHeader,
    AlertDialogTitle,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogCancel,
    AlertDialogAction,
} from "@/components/ui/alert-dialog";
import { useFileStore } from "@/stores/file-store";

interface DeleteFileDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    filePath: string;
    isDirectory: boolean;
}

function DeleteFileDialog({ open, onOpenChange, filePath, isDirectory }: DeleteFileDialogProps) {
    const fileName = filePath.split("/").pop() ?? filePath;
    const [error, setError] = useState<string | null>(null);
    const [submitting, setSubmitting] = useState(false);
    const deleteFile = useFileStore((s) => s.deleteFile);

    useEffect(() => {
        if (open) {
            setError(null);
            setSubmitting(false);
        }
    }, [open]);

    const handleDelete = async () => {
        setSubmitting(true);
        setError(null);
        try {
            await deleteFile(filePath);
            onOpenChange(false);
        } catch (e) {
            console.error("Delete failed:", e);
            setError(e instanceof Error ? e.message : "Delete failed");
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <AlertDialog open={open} onOpenChange={onOpenChange}>
            <AlertDialogContent size="sm">
                <AlertDialogHeader>
                    <AlertDialogTitle>
                        Delete &ldquo;{fileName}&rdquo;{isDirectory ? " and all its contents" : ""}?
                    </AlertDialogTitle>
                    <AlertDialogDescription>This cannot be undone.</AlertDialogDescription>
                    {error && <p className="text-destructive text-sm">{error}</p>}
                </AlertDialogHeader>
                <AlertDialogFooter>
                    <AlertDialogCancel disabled={submitting}>Cancel</AlertDialogCancel>
                    <AlertDialogAction
                        variant="destructive"
                        onClick={(e) => {
                            e.preventDefault();
                            void handleDelete();
                        }}
                        disabled={submitting}>
                        Delete
                    </AlertDialogAction>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    );
}

export { DeleteFileDialog };
