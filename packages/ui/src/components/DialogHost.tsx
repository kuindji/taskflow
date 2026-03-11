import { useCallback } from "react";
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
import { buttonVariants } from "@/components/ui/button";
import { Loader2 } from "lucide-react";
import { useDialogStore } from "@/stores/dialog-store";
import { cn } from "@/lib/utils";

export function DialogHost() {
    const {
        open,
        mode,
        title,
        description,
        confirmLabel,
        cancelLabel,
        variant,
        loading,
        error,
        onConfirm,
        resolve,
        setLoading,
        setError,
        dismiss,
    } = useDialogStore();

    const handleConfirm = useCallback(async () => {
        setError(null);

        if (!onConfirm) {
            resolve?.(true);
            dismiss();
            return;
        }

        try {
            const result = onConfirm();
            if (result && typeof result.then === "function") {
                setLoading(true);
                await result;
                setLoading(false);
            }
            resolve?.(true);
            dismiss();
        } catch (err) {
            setLoading(false);
            setError(err instanceof Error ? err.message : "Action failed. Please try again.");
        }
    }, [onConfirm, resolve, setLoading, setError, dismiss]);

    const handleCancel = useCallback(() => {
        resolve?.(false);
        dismiss();
    }, [resolve, dismiss]);

    const handleOpenChange = useCallback(
        (nextOpen: boolean) => {
            if (!nextOpen && !loading) handleCancel();
        },
        [loading, handleCancel],
    );

    return (
        <AlertDialog open={open} onOpenChange={handleOpenChange}>
            <AlertDialogContent>
                <AlertDialogHeader>
                    <AlertDialogTitle>{title}</AlertDialogTitle>
                    <AlertDialogDescription>{description}</AlertDialogDescription>
                    {error && <p className="text-destructive text-sm">{error}</p>}
                </AlertDialogHeader>
                <AlertDialogFooter>
                    {mode === "confirm" && (
                        <AlertDialogCancel disabled={loading}>{cancelLabel}</AlertDialogCancel>
                    )}
                    <AlertDialogAction
                        onClick={(e) => {
                            e.preventDefault();
                            void handleConfirm();
                        }}
                        disabled={loading}
                        className={cn(
                            variant === "destructive" && buttonVariants({ variant: "destructive" }),
                        )}
                    >
                        {loading && <Loader2 className="h-4 w-4 animate-spin" />}
                        {confirmLabel}
                    </AlertDialogAction>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    );
}
