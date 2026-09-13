import { useCallback, useEffect, useState } from "react";
import type { MenuEntry } from "@taskflow/shared";
import { Button } from "@/components/ui/button";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useBackendStore } from "@/stores/backend-store";
import { ipcErrorMessage, parsePort } from "./backend-fields";

interface ManageBackendsDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
}

interface BackendRowProps {
    entry: MenuEntry;
    isPrimary: boolean;
    onError: (message: string | null) => void;
}

function BackendRow({ entry, isPrimary, onError }: BackendRowProps) {
    const savedSshPort = entry.sshPort === undefined ? "" : String(entry.sshPort);
    const [displayName, setDisplayName] = useState(entry.displayName);
    const [user, setUser] = useState(entry.user ?? "");
    const [sshPort, setSshPort] = useState(savedSshPort);
    const [busy, setBusy] = useState(false);
    const dirty =
        displayName !== entry.displayName ||
        user !== (entry.user ?? "") ||
        sshPort !== savedSshPort;

    async function handleSave(): Promise<void> {
        const bridge = window.taskflow;
        if (!bridge) return;
        const name = displayName.trim();
        const sshUser = user.trim();
        const parsedSshPort = parsePort(sshPort);
        // Blank here is a cleared value that was working, not a default left
        // alone: say so rather than save something the user did not type.
        if (name.length === 0 || sshUser.length === 0) {
            onError("Name and SSH user cannot be empty.");
            return;
        }
        if (parsedSshPort === "invalid") {
            onError("The SSH port must be a whole number from 1 to 65535.");
            return;
        }
        setBusy(true);
        try {
            const result = await bridge.updateBackend(entry.id, {
                displayName: name,
                user: sshUser,
                sshPort: parsedSshPort,
            });
            onError(result.ok ? null : (result.reason ?? "Could not save that backend."));
        } catch (saveError) {
            onError(ipcErrorMessage(saveError, "Could not save that backend."));
        } finally {
            setBusy(false);
        }
    }

    async function handleRemove(): Promise<void> {
        const bridge = window.taskflow;
        if (!bridge) return;
        setBusy(true);
        try {
            const store = useBackendStore.getState();
            // Close the socket and drop the machine's slices first: removing the
            // record in main leaves the renderer's connection and data behind.
            if (store.machines.some((m) => m.id === entry.id)) await store.detach(entry.id);
            const result = await bridge.removeBackend(entry.id);
            onError(result.ok ? null : (result.reason ?? "Could not remove that backend."));
        } catch (removeError) {
            onError(ipcErrorMessage(removeError, "Could not remove that backend."));
        } finally {
            setBusy(false);
        }
    }

    return (
        <li className="flex flex-col gap-1.5 py-3">
            <div className="text-muted-foreground truncate text-xs" title={entry.id}>
                {entry.host}
                {entry.instanceId !== "main" && ` · ${entry.instanceId}`}
            </div>
            <div className="flex items-center gap-2">
                <Input
                    aria-label="Name"
                    className="min-w-0 flex-1"
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                />
                <Input
                    aria-label="SSH user"
                    className="w-28"
                    value={user}
                    onChange={(e) => setUser(e.target.value)}
                />
                <Input
                    aria-label="SSH port"
                    className="w-16"
                    inputMode="numeric"
                    placeholder="22"
                    value={sshPort}
                    onChange={(e) => setSshPort(e.target.value)}
                />
                <Button
                    size="sm"
                    variant="secondary"
                    disabled={busy || !dirty}
                    onClick={() => void handleSave()}>
                    Save
                </Button>
                <Button
                    size="sm"
                    variant="ghost"
                    className="text-destructive"
                    disabled={busy || isPrimary}
                    title={isPrimary ? "This is the machine you are working as" : undefined}
                    onClick={() => void handleRemove()}>
                    Remove
                </Button>
            </div>
        </li>
    );
}

function ManageBackendsDialog({ open, onOpenChange }: ManageBackendsDialogProps) {
    const primaryId = useBackendStore((s) => s.primaryId);
    const [entries, setEntries] = useState<MenuEntry[]>([]);
    const [error, setError] = useState<string | null>(null);

    const load = useCallback(() => {
        window.taskflow?.listBackends().then(
            (list) => setEntries(list.filter((entry) => entry.saved)),
            (listError: unknown) =>
                setError(ipcErrorMessage(listError, "Could not list backends.")),
        );
    }, []);

    // Saves and removals come back as `backends-changed`, as does a first
    // handshake renaming a record onto its uid.
    useEffect(() => {
        if (!open) return;
        load();
        return window.taskflow?.onBackendsChanged(load);
    }, [open, load]);

    return (
        <Dialog
            open={open}
            onOpenChange={(next) => {
                if (!next) setError(null);
                onOpenChange(next);
            }}>
            <DialogContent className="sm:max-w-2xl">
                <DialogHeader>
                    <DialogTitle>Manage backends</DialogTitle>
                    <DialogDescription>
                        Saved machines. SSH changes apply the next time a machine connects.
                    </DialogDescription>
                </DialogHeader>
                {entries.length === 0 ? (
                    <p className="text-muted-foreground text-sm">No saved machines.</p>
                ) : (
                    <ul className="divide-border divide-y">
                        {entries.map((entry) => (
                            <BackendRow
                                key={entry.id}
                                entry={entry}
                                isPrimary={entry.id === primaryId}
                                onError={setError}
                            />
                        ))}
                    </ul>
                )}
                {error && <p className="text-destructive text-xs">{error}</p>}
            </DialogContent>
        </Dialog>
    );
}

export { ManageBackendsDialog };
