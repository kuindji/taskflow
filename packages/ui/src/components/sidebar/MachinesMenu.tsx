import { useCallback, useEffect, useState } from "react";
import type { MenuEntry, TunnelFailure } from "@taskflow/shared";
import { Loader2, Monitor, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
    DropdownMenu,
    DropdownMenuCheckboxItem,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuSub,
    DropdownMenuSubContent,
    DropdownMenuSubTrigger,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
    getElementMenuPosition,
    showNativeMenuAndRun,
    supportsNativeMenus,
} from "@/lib/native-menu";
import type { NativeMenuActionMap, NativeMenuItem } from "@/lib/native-menu";
import { cn } from "@/lib/utils";
import { useBackendStore } from "@/stores/backend-store";
import type { MachineState } from "@/stores/backend-store";
import { ipcErrorMessage } from "./backend-fields";
import { ConnectBackendDialog } from "./ConnectBackendDialog";
import { ManageBackendsDialog } from "./ManageBackendsDialog";
import { TrustHostKeyDialog } from "./TrustHostKeyDialog";

interface MachinesMenuProps {
    masterWorkspaceActive: boolean;
    onMasterWorkspace: () => void;
}

/** One machine line, built once for both the native and the Radix menu. */
interface MachineRow {
    id: string;
    label: string;
    status: string;
    /** `null` for a discovered machine that is not saved: it gets "Add", not a checkbox. */
    checked: boolean | null;
    enabled: boolean;
}

function nameOf(displayName: string, instanceId: string): string {
    return instanceId === "main" ? displayName : `${displayName} · ${instanceId}`;
}

function statusOf(machine: MachineState, seen: boolean): string {
    if (machine.isLocal) return "";
    switch (machine.state) {
        case "attaching":
            return "connecting";
        case "attached":
            return "attached";
        case "incompatible":
            return "needs update";
        case "offline":
            if (machine.failure) return machine.failure.message;
            if (machine.keepAttached) return "offline";
            return seen ? "seen" : "saved, not seen";
    }
}

function buildRows(
    machines: MachineState[],
    entries: MenuEntry[],
    primaryId: string | null,
): MachineRow[] {
    const seen = new Set(entries.filter((entry) => entry.seen).map((entry) => entry.id));
    const rows: MachineRow[] = machines.map((machine) => ({
        id: machine.id,
        label: machine.isLocal
            ? "This machine (local)"
            : nameOf(machine.displayName, machine.instanceId),
        status: statusOf(machine, seen.has(machine.id)),
        // `keepAttached`, not `state`: a machine whose tunnel died is still one
        // the user wants, and unticking it is how they say otherwise.
        checked: machine.keepAttached,
        // Primary is what the app-level surfaces address, so it cannot be
        // detached from here. Leaving it is a hard switch ("Work as…").
        enabled: machine.id !== primaryId,
    }));
    const known = new Set(machines.map((machine) => machine.id));
    for (const entry of entries) {
        if (entry.saved || known.has(entry.id)) continue;
        rows.push({
            id: entry.id,
            label: nameOf(entry.displayName, entry.instanceId),
            status: "seen",
            checked: null,
            enabled: true,
        });
    }
    return rows;
}

function isHostKeyFailure(failure: TunnelFailure | undefined): failure is TunnelFailure {
    return failure?.kind === "unknown-host-key" || failure?.kind === "changed-host-key";
}

/**
 * The sidebar's machine switchboard. A checkbox per machine attaches or
 * detaches it live; hard switching ("Work as…") is a separate submenu, because
 * a menu where attaching and switching look alike gets them confused.
 */
function MachinesMenu({ masterWorkspaceActive, onMasterWorkspace }: MachinesMenuProps) {
    const machines = useBackendStore((s) => s.machines);
    const primaryId = useBackendStore((s) => s.primaryId);
    const [open, setOpen] = useState(false);
    const [entries, setEntries] = useState<MenuEntry[]>([]);
    const [notice, setNotice] = useState<string | null>(null);
    const [connectOpen, setConnectOpen] = useState(false);
    const [manageOpen, setManageOpen] = useState(false);
    const [dismissedFailures, setDismissedFailures] = useState<ReadonlySet<TunnelFailure>>(
        () => new Set(),
    );
    const hasBridge = window.taskflow !== undefined;

    // A beacon answering the probe, a save or a rename all arrive this way.
    useEffect(
        () =>
            window.taskflow?.onBackendsChanged(() => {
                window.taskflow?.listBackends().then(setEntries, () => {});
            }),
        [],
    );

    /** Probe first, so the list is fresh rather than up to one announce interval old. */
    const reload = useCallback(async (): Promise<MenuEntry[] | null> => {
        const bridge = window.taskflow;
        if (!bridge) return null;
        bridge.probeBackends().catch(() => {});
        const [listed] = await Promise.allSettled([
            bridge.listBackends(),
            useBackendStore.getState().refresh(),
        ]);
        if (listed.status !== "fulfilled") return null;
        setEntries(listed.value);
        return listed.value;
    }, []);

    async function addDiscovered(row: MachineRow): Promise<void> {
        const bridge = window.taskflow;
        if (!bridge) return;
        try {
            const record = await bridge.addDiscoveredBackend(row.id);
            if (!record) {
                setNotice(`${row.label} stopped announcing itself.`);
                return;
            }
            // `attach` reports on the row, so it must exist before the attach.
            await useBackendStore.getState().refresh();
            await useBackendStore.getState().attach(record.id);
        } catch (error) {
            setNotice(ipcErrorMessage(error, `Could not add ${row.label}.`));
        }
    }

    function toggle(row: MachineRow): void {
        setNotice(null);
        const store = useBackendStore.getState();
        const run =
            row.checked === null
                ? addDiscovered(row)
                : row.checked
                  ? store.detach(row.id)
                  : store.attach(row.id);
        run.catch((error: unknown) => {
            setNotice(ipcErrorMessage(error, `Could not change ${row.label}.`));
        });
    }

    const rows = buildRows(machines, entries, primaryId);
    const workAsTargets = machines.filter((machine) => machine.id !== primaryId);

    async function openNativeMenu(target: HTMLElement): Promise<void> {
        const listed = await reload();
        const store = useBackendStore.getState();
        const items: NativeMenuItem[] = [];
        const actions: NativeMenuActionMap = {};

        items.push({
            id: "master",
            label: "Master Workspace",
            type: "checkbox",
            checked: masterWorkspaceActive,
        });
        actions.master = onMasterWorkspace;
        items.push({ type: "separator" });
        if (notice) items.push({ type: "label", label: notice });
        for (const row of buildRows(store.machines, listed ?? entries, store.primaryId)) {
            // Native items have no trailing column: the status joins the label.
            const label = row.status ? `${row.label} — ${row.status}` : row.label;
            const id = `machine:${row.id}`;
            if (row.checked === null) {
                items.push({ id, label: `Add ${label}` });
            } else {
                items.push({
                    id,
                    label,
                    type: "checkbox",
                    checked: row.checked,
                    enabled: row.enabled,
                });
            }
            if (row.enabled) actions[id] = () => toggle(row);
        }
        items.push({ type: "separator" });
        const targets = store.machines.filter((machine) => machine.id !== store.primaryId);
        items.push({
            label: "Work as…",
            type: "submenu",
            // TODO(remote-projects): Task 21 adds the hard switch these run.
            submenu:
                targets.length === 0
                    ? [{ label: "No other machines", enabled: false }]
                    : targets.map((machine) => ({
                          label: nameOf(machine.displayName, machine.instanceId),
                          enabled: false,
                      })),
        });
        items.push({ id: "connect", label: "Connect to backend…" });
        actions.connect = () => setConnectOpen(true);
        items.push({ id: "manage", label: "Manage backends…" });
        actions.manage = () => setManageOpen(true);

        await showNativeMenuAndRun(items, actions, getElementMenuPosition(target, "start"));
    }

    const attaching = machines.some((m) => m.keepAttached && m.state === "attaching");
    const unhealthy = machines.some(
        (m) =>
            !m.isLocal && m.keepAttached && (m.state === "offline" || m.state === "incompatible"),
    );
    const remoteAttached = machines.some((m) => !m.isLocal && m.state === "attached");

    const trigger = (
        <Button
            variant="ghost"
            size="icon-xs"
            aria-label="Machines"
            tooltip="Machines"
            tooltipSide="right"
            onClick={
                supportsNativeMenus()
                    ? (event) => void openNativeMenu(event.currentTarget)
                    : undefined
            }
            className={cn(
                "relative [-webkit-app-region:no-drag]",
                unhealthy ? "text-destructive" : masterWorkspaceActive ? "text-accent" : "",
            )}>
            {attaching ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
                <Monitor className="h-3.5 w-3.5" />
            )}
            {remoteAttached && (
                <span className="bg-success absolute right-0.5 bottom-0.5 h-1.5 w-1.5 rounded-full" />
            )}
        </Button>
    );

    const trustMachine = machines.find(
        (machine) => isHostKeyFailure(machine.failure) && !dismissedFailures.has(machine.failure),
    );

    return (
        <>
            {supportsNativeMenus() ? (
                trigger
            ) : (
                <DropdownMenu
                    open={open}
                    onOpenChange={(next) => {
                        setOpen(next);
                        if (next) void reload();
                    }}>
                    <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
                    <DropdownMenuContent side="top" align="start" className="min-w-64">
                        <DropdownMenuCheckboxItem
                            checked={masterWorkspaceActive}
                            onSelect={onMasterWorkspace}>
                            Master Workspace
                        </DropdownMenuCheckboxItem>
                        <DropdownMenuSeparator />
                        {notice && (
                            <DropdownMenuLabel className="text-destructive">
                                {notice}
                            </DropdownMenuLabel>
                        )}
                        {rows.map((row) =>
                            row.checked === null ? (
                                <DropdownMenuItem key={row.id} onSelect={() => toggle(row)}>
                                    <Plus />
                                    <span className="min-w-0 flex-1 truncate">Add {row.label}</span>
                                    <span className="text-muted-foreground text-xs">
                                        {row.status}
                                    </span>
                                </DropdownMenuItem>
                            ) : (
                                <DropdownMenuCheckboxItem
                                    key={row.id}
                                    checked={row.checked}
                                    disabled={!row.enabled}
                                    onSelect={(event) => {
                                        // Stay open: ticking several machines is one gesture.
                                        event.preventDefault();
                                        toggle(row);
                                    }}>
                                    <span className="min-w-0 flex-1 truncate">{row.label}</span>
                                    {row.status && (
                                        <span
                                            className="text-muted-foreground max-w-40 truncate text-xs"
                                            title={row.status}>
                                            {row.status}
                                        </span>
                                    )}
                                </DropdownMenuCheckboxItem>
                            ),
                        )}
                        <DropdownMenuSeparator />
                        <DropdownMenuSub>
                            <DropdownMenuSubTrigger>Work as…</DropdownMenuSubTrigger>
                            <DropdownMenuSubContent>
                                {/* TODO(remote-projects): Task 21 adds the hard switch these run. */}
                                {workAsTargets.length === 0 ? (
                                    <DropdownMenuItem disabled>No other machines</DropdownMenuItem>
                                ) : (
                                    workAsTargets.map((machine) => (
                                        <DropdownMenuItem key={machine.id} disabled>
                                            {nameOf(machine.displayName, machine.instanceId)}
                                        </DropdownMenuItem>
                                    ))
                                )}
                            </DropdownMenuSubContent>
                        </DropdownMenuSub>
                        <DropdownMenuItem
                            disabled={!hasBridge}
                            onSelect={() => setConnectOpen(true)}>
                            Connect to backend…
                        </DropdownMenuItem>
                        <DropdownMenuItem
                            disabled={!hasBridge}
                            onSelect={() => setManageOpen(true)}>
                            Manage backends…
                        </DropdownMenuItem>
                    </DropdownMenuContent>
                </DropdownMenu>
            )}
            <ConnectBackendDialog open={connectOpen} onOpenChange={setConnectOpen} />
            <ManageBackendsDialog open={manageOpen} onOpenChange={setManageOpen} />
            {trustMachine && isHostKeyFailure(trustMachine.failure) && (
                <TrustHostKeyDialog
                    key={trustMachine.id}
                    machine={trustMachine}
                    failure={trustMachine.failure}
                    onDismiss={() => {
                        const failure = trustMachine.failure;
                        if (!failure) return;
                        setDismissedFailures((current) => new Set(current).add(failure));
                    }}
                />
            )}
        </>
    );
}

export { MachinesMenu };
