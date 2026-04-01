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

interface MoveFileDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    sourcePath: string;
    destinationDir: string;
}

function MoveFileDialog({ open, onOpenChange, sourcePath, destinationDir }: MoveFileDialogProps) {
    const fileName = sourcePath.split("/").pop() ?? sourcePath;
    const destDirName = destinationDir.split("/").pop() ?? destinationDir;
    const [error, setError] = useState<string | null>(null);
    const [submitting, setSubmitting] = useState(false);
    const renameFile = useFileStore((s) => s.renameFile);

    useEffect(() => {
        if (open) {
            setError(null);
            setSubmitting(false);
        }
    }, [open]);

    const handleMove = async () => {
        setSubmitting(true);
        setError(null);
        try {
            const newPath = destinationDir + "/" + fileName;
            await renameFile(sourcePath, newPath);
            onOpenChange(false);
        } catch (e) {
            console.error("Move failed:", e);
            setError(e instanceof Error ? e.message : "Move failed");
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <AlertDialog open={open} onOpenChange={onOpenChange}>
            <AlertDialogContent size="sm">
                <AlertDialogHeader>
                    <AlertDialogTitle>
                        Move &ldquo;{fileName}&rdquo; to &ldquo;{destDirName}&rdquo;?
                    </AlertDialogTitle>
                    <AlertDialogDescription>
                        This will move the item to a new location.
                    </AlertDialogDescription>
                    {error && <p className="text-destructive text-sm">{error}</p>}
                </AlertDialogHeader>
                <AlertDialogFooter>
                    <AlertDialogCancel disabled={submitting}>Cancel</AlertDialogCancel>
                    <AlertDialogAction
                        onClick={(e) => {
                            e.preventDefault();
                            void handleMove();
                        }}
                        disabled={submitting}>
                        Move
                    </AlertDialogAction>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    );
}

export { MoveFileDialog };
