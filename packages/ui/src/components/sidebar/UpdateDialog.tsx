import type { DesktopUpdateState } from "@taskflow/shared";
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

interface UpdateDialogProps {
    updateStatus: DesktopUpdateState;
    dialogOpen: boolean;
    onDialogOpenChange(open: boolean): void;
    onInstall(): void;
    onRetry(): void;
}

function UpdateStatusButtons({
    updateStatus,
    onDialogOpenChange,
}: Pick<UpdateDialogProps, "updateStatus" | "onDialogOpenChange">) {
    const status = updateStatus.status;
    if (status === "checking" || status === "downloading" || status === "installing") {
        const label =
            status === "checking"
                ? "Checking for updates"
                : status === "installing"
                  ? "Installing update"
                  : "Downloading update";
        const tooltip =
            status === "downloading"
                ? `Downloading v${updateStatus.availableVersion ?? ""}...`
                : `${label}...`;
        return (
            <Button
                variant="ghost"
                size="icon-xs"
                disabled
                aria-label={label}
                tooltip={tooltip}
                tooltipSide="right"
                className="[-webkit-app-region:no-drag]">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
            </Button>
        );
    }

    if (
        updateStatus.errorContext !== null ||
        (status === "ready" && updateStatus.downloadedVersion !== null)
    ) {
        return (
            <Button
                variant="ghost"
                size="icon-xs"
                onClick={() => onDialogOpenChange(true)}
                aria-label={updateStatus.errorContext ? "Update failed" : "Update available"}
                tooltip={
                    updateStatus.message ??
                    `v${updateStatus.downloadedVersion ?? ""} available, click to update`
                }
                tooltipSide="right"
                className="text-accent [-webkit-app-region:no-drag]">
                <ArrowDownToLine className="h-3.5 w-3.5" />
            </Button>
        );
    }

    return null;
}

function UpdateDialog({
    updateStatus,
    dialogOpen,
    onDialogOpenChange,
    onInstall,
    onRetry,
}: UpdateDialogProps) {
    const { status, downloadedVersion, errorContext, canRetry } = updateStatus;
    const installing = status === "installing";
    const busy = installing || status === "checking" || status === "downloading";
    const canInstall = status === "ready" && downloadedVersion !== null;
    const failureTitle =
        errorContext === "check"
            ? "Update Check Failed"
            : errorContext === "download"
              ? "Update Download Failed"
              : errorContext === "install"
                ? "Update Installation Failed"
                : null;
    return (
        <>
            <UpdateStatusButtons
                updateStatus={updateStatus}
                onDialogOpenChange={onDialogOpenChange}
            />
            <AlertDialog open={dialogOpen} onOpenChange={onDialogOpenChange}>
                <AlertDialogContent size="sm">
                    <AlertDialogHeader>
                        <AlertDialogTitle>
                            {failureTitle ??
                                (installing ? "Installing Update" : "Update Available")}
                        </AlertDialogTitle>
                        <AlertDialogDescription>
                            {failureTitle ? (
                                <>
                                    {updateStatus.message}
                                    {errorContext === "install" && downloadedVersion !== null && (
                                        <>
                                            {" "}
                                            Taskflow v{downloadedVersion} is still ready to install.
                                        </>
                                    )}
                                </>
                            ) : installing ? (
                                "Installing update..."
                            ) : status === "checking" ? (
                                "Checking for updates..."
                            ) : status === "downloading" ? (
                                "Downloading update..."
                            ) : canInstall ? (
                                <>
                                    Taskflow v{downloadedVersion} is ready to install. The app will
                                    restart to apply the update.
                                </>
                            ) : null}
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel size="sm">Later</AlertDialogCancel>
                        {failureTitle
                            ? canRetry && (
                                  <AlertDialogAction
                                      size="sm"
                                      disabled={busy || (errorContext === "install" && !canInstall)}
                                      onClick={errorContext === "install" ? onInstall : onRetry}>
                                      Retry
                                  </AlertDialogAction>
                              )
                            : (canInstall || installing) && (
                                  <AlertDialogAction
                                      size="sm"
                                      disabled={busy || !canInstall}
                                      onClick={onInstall}>
                                      Restart Now
                                  </AlertDialogAction>
                              )}
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </>
    );
}

export { UpdateDialog };
