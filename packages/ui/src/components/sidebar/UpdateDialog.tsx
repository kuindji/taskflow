import { Button } from "@/components/ui/button";
import { ArrowDownToLine, Loader2 } from "lucide-react";
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

interface UpdateStatus {
    status: "idle" | "checking" | "downloading" | "ready";
    version?: string;
}

interface UpdateDialogProps {
    updateStatus: UpdateStatus;
    dialogOpen: boolean;
    onDialogOpenChange: (open: boolean) => void;
}

function UpdateStatusButtons({ updateStatus, onDialogOpenChange }: UpdateDialogProps) {
    if (updateStatus.status === "checking") {
        return (
            <Button
                variant="ghost"
                size="icon-xs"
                disabled
                aria-label="Checking for updates"
                tooltip="Checking for updates..."
                tooltipSide="right"
                className="[-webkit-app-region:no-drag]">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
            </Button>
        );
    }

    if (updateStatus.status === "downloading") {
        return (
            <Button
                variant="ghost"
                size="icon-xs"
                disabled
                aria-label="Downloading update"
                tooltip={`Downloading v${updateStatus.version ?? ""}...`}
                tooltipSide="right"
                className="[-webkit-app-region:no-drag]">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
            </Button>
        );
    }

    if (updateStatus.status === "ready") {
        return (
            <Button
                variant="ghost"
                size="icon-xs"
                onClick={() => onDialogOpenChange(true)}
                aria-label="Update available"
                tooltip={`v${updateStatus.version ?? ""} available — click to update`}
                tooltipSide="right"
                className="text-accent [-webkit-app-region:no-drag]">
                <ArrowDownToLine className="h-3.5 w-3.5" />
            </Button>
        );
    }

    return null;
}

function UpdateDialog({ updateStatus, dialogOpen, onDialogOpenChange }: UpdateDialogProps) {
    return (
        <>
            <UpdateStatusButtons
                updateStatus={updateStatus}
                dialogOpen={dialogOpen}
                onDialogOpenChange={onDialogOpenChange}
            />
            <AlertDialog open={dialogOpen} onOpenChange={onDialogOpenChange}>
                <AlertDialogContent size="sm">
                    <AlertDialogHeader>
                        <AlertDialogTitle>Update Available</AlertDialogTitle>
                        <AlertDialogDescription>
                            Taskflow v{updateStatus.version} is ready to install. The app will
                            restart to apply the update.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel size="sm">Later</AlertDialogCancel>
                        <AlertDialogAction
                            size="sm"
                            onClick={() => window.taskflow?.quitAndInstallUpdate()}>
                            Restart Now
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </>
    );
}

export { UpdateDialog };
export type { UpdateStatus };
