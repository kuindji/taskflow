import { useEffect, useState } from "react";
import type { TunnelFailure } from "@taskflow/shared";
import { Button } from "@/components/ui/button";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { useBackendStore } from "@/stores/backend-store";
import type { MachineState } from "@/stores/backend-store";
import { ipcErrorMessage } from "./backend-fields";

interface TrustHostKeyDialogProps {
    machine: MachineState;
    /** The row's host-key failure: `unknown-host-key` or `changed-host-key`. */
    failure: TunnelFailure;
    onDismiss: () => void;
}

interface HostKey {
    type: string;
    fingerprint: string;
}

/** `ssh-keygen -lf -` prints one `<bits> <fingerprint> <comment> (<type>)` line per key. */
function parseFingerprints(output: string): HostKey[] {
    return output
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.length > 0)
        .map((line) => {
            const match = /^\d+\s+(\S+).*\(([^)]+)\)$/.exec(line);
            const fingerprint = match?.[1];
            const type = match?.[2];
            return fingerprint && type ? { fingerprint, type } : { fingerprint: line, type: "" };
        });
}

/**
 * First contact with a host whose key the app has not pinned. The fingerprint
 * comes from main's own scan, and approving pins exactly that scan. A changed
 * key is never offered for approval — that is what interception looks like —
 * so it gets ssh's message and the offending known_hosts line, and a Close.
 */
function TrustHostKeyDialog({ machine, failure, onDismiss }: TrustHostKeyDialogProps) {
    const attach = useBackendStore((s) => s.attach);
    const changed = failure.kind === "changed-host-key";
    const [keys, setKeys] = useState<HostKey[] | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const [scan, setScan] = useState(0);

    useEffect(() => {
        const bridge = window.taskflow;
        if (changed || !bridge) return;
        let cancelled = false;
        bridge.getHostFingerprint(machine.id).then(
            (result) => {
                if (cancelled) return;
                if (result.ok) setKeys(parseFingerprints(result.fingerprint));
                else setError(result.reason);
            },
            (scanError: unknown) => {
                if (!cancelled)
                    setError(ipcErrorMessage(scanError, "Could not read the host key."));
            },
        );
        return () => {
            cancelled = true;
        };
    }, [changed, machine.id, scan]);

    function checkAgain(): void {
        setKeys(null);
        setError(null);
        setScan((n) => n + 1);
    }

    async function handleTrust(): Promise<void> {
        const bridge = window.taskflow;
        if (!bridge) return;
        setBusy(true);
        try {
            const result = await bridge.trustBackendHost(machine.id);
            if (!result.ok) {
                // Main pins only the scan this dialog showed; a refusal means the
                // two came apart (the address moved), so the user must look again.
                setKeys(null);
                setError(result.reason ?? "Could not trust that host key.");
                return;
            }
        } catch (trustError) {
            setKeys(null);
            setError(ipcErrorMessage(trustError, "Could not trust that host key."));
            return;
        } finally {
            setBusy(false);
        }
        // The attach clears the row's failure, which unmounts this dialog.
        void attach(machine.id);
    }

    const offending = failure.stderr
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.startsWith("Offending"));

    return (
        <Dialog open onOpenChange={(open) => !open && onDismiss()}>
            <DialogContent className="sm:max-w-lg">
                <DialogHeader>
                    <DialogTitle>{changed ? "Host key changed" : "Trust this host?"}</DialogTitle>
                    <DialogDescription>
                        {machine.displayName} ({machine.host})
                    </DialogDescription>
                </DialogHeader>

                {changed ? (
                    <div className="flex flex-col gap-2 text-sm">
                        <p>{failure.message}</p>
                        {offending.length > 0 && (
                            <pre className="bg-muted overflow-x-auto rounded p-2 text-xs">
                                {offending.join("\n")}
                            </pre>
                        )}
                    </div>
                ) : (
                    <div className="flex flex-col gap-2 text-sm">
                        <p className="text-muted-foreground">
                            Taskflow has not connected to this host before. A machine found on the
                            network can be anyone&apos;s: compare the fingerprint with the machine
                            itself before trusting it.
                        </p>
                        {keys === null && error === null && (
                            <p className="text-muted-foreground text-xs">Reading the host key…</p>
                        )}
                        {keys && (
                            <dl className="flex flex-col gap-1.5">
                                {keys.map((key) => (
                                    <div key={key.fingerprint}>
                                        <dt className="text-muted-foreground text-xs">
                                            {key.type || "Key"}
                                        </dt>
                                        <dd className="font-mono text-xs break-all">
                                            {key.fingerprint}
                                        </dd>
                                    </div>
                                ))}
                            </dl>
                        )}
                        {error && <p className="text-destructive text-xs">{error}</p>}
                    </div>
                )}

                <DialogFooter>
                    {changed ? (
                        <Button variant="secondary" onClick={onDismiss}>
                            Close
                        </Button>
                    ) : (
                        <>
                            <Button variant="secondary" onClick={onDismiss}>
                                Cancel
                            </Button>
                            {error && (
                                <Button variant="outline" disabled={busy} onClick={checkAgain}>
                                    Check again
                                </Button>
                            )}
                            <Button
                                disabled={busy || keys === null || keys.length === 0}
                                onClick={() => void handleTrust()}
                                className="bg-accent text-accent-foreground hover:bg-accent/90">
                                Trust and connect
                            </Button>
                        </>
                    )}
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

export { TrustHostKeyDialog };
