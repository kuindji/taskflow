import { useState } from "react";
import type { SyntheticEvent } from "react";
import { Button } from "@/components/ui/button";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useBackendStore } from "@/stores/backend-store";
import { ipcErrorMessage, parsePort } from "./backend-fields";

interface ConnectBackendDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
}

function ConnectBackendDialog({ open, onOpenChange }: ConnectBackendDialogProps) {
    const refresh = useBackendStore((s) => s.refresh);
    const attach = useBackendStore((s) => s.attach);
    const [host, setHost] = useState("");
    const [port, setPort] = useState("");
    const [user, setUser] = useState("");
    const [sshPort, setSshPort] = useState("");
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);

    function handleOpenChange(next: boolean): void {
        if (!next) {
            setHost("");
            setPort("");
            setUser("");
            setSshPort("");
            setError(null);
        }
        onOpenChange(next);
    }

    async function handleSubmit(event: SyntheticEvent<HTMLFormElement>): Promise<void> {
        event.preventDefault();
        const bridge = window.taskflow;
        if (!bridge || host.trim().length === 0 || busy) return;
        const parsedPort = parsePort(port);
        const parsedSshPort = parsePort(sshPort);
        if (parsedPort === "invalid" || parsedSshPort === "invalid") {
            setError("Ports must be whole numbers from 1 to 65535.");
            return;
        }
        setBusy(true);
        setError(null);
        try {
            const record = await bridge.addBackend({
                host: host.trim(),
                user: user.trim() || undefined,
                sshPort: parsedSshPort,
                port: parsedPort,
            });
            // `attach` reports progress on the machine's row, so the row must
            // exist first; a patch to a missing row is dropped.
            await refresh();
            handleOpenChange(false);
            // Failures land on the row: its sidebar section says why, and a
            // host-key failure opens the trust dialog from the machines menu.
            void attach(record.id);
        } catch (submitError) {
            setError(ipcErrorMessage(submitError, "Could not add that backend."));
        } finally {
            setBusy(false);
        }
    }

    return (
        <Dialog open={open} onOpenChange={handleOpenChange}>
            <DialogContent className="sm:max-w-md">
                <form className="flex flex-col gap-4" onSubmit={(e) => void handleSubmit(e)}>
                    <DialogHeader>
                        <DialogTitle>Connect to backend</DialogTitle>
                        <DialogDescription>
                            Taskflow reaches the machine over ssh, using your ssh keys and config.
                        </DialogDescription>
                    </DialogHeader>

                    <div className="flex flex-col gap-3">
                        <div className="flex flex-col gap-1.5">
                            <Label htmlFor="connect-backend-host">Host</Label>
                            <Input
                                id="connect-backend-host"
                                placeholder="desktop.local or 192.168.1.20"
                                value={host}
                                onChange={(e) => setHost(e.target.value)}
                                autoFocus
                            />
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                            <div className="flex flex-col gap-1.5">
                                <Label htmlFor="connect-backend-user">SSH user</Label>
                                <Input
                                    id="connect-backend-user"
                                    placeholder="your username"
                                    value={user}
                                    onChange={(e) => setUser(e.target.value)}
                                />
                            </div>
                            <div className="flex flex-col gap-1.5">
                                <Label htmlFor="connect-backend-ssh-port">SSH port</Label>
                                <Input
                                    id="connect-backend-ssh-port"
                                    placeholder="22"
                                    inputMode="numeric"
                                    value={sshPort}
                                    onChange={(e) => setSshPort(e.target.value)}
                                />
                            </div>
                        </div>
                        <div className="flex flex-col gap-1.5">
                            <Label htmlFor="connect-backend-port">Backend port</Label>
                            <Input
                                id="connect-backend-port"
                                placeholder="found over ssh"
                                inputMode="numeric"
                                value={port}
                                onChange={(e) => setPort(e.target.value)}
                            />
                        </div>

                        {error && <p className="text-destructive text-xs">{error}</p>}
                    </div>

                    <DialogFooter>
                        <Button
                            type="button"
                            variant="secondary"
                            onClick={() => handleOpenChange(false)}>
                            Cancel
                        </Button>
                        <Button
                            type="submit"
                            disabled={busy || host.trim().length === 0}
                            className="bg-accent text-accent-foreground hover:bg-accent/90">
                            Connect
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    );
}

export { ConnectBackendDialog };
