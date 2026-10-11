import { useCallback, useMemo, useState } from "react";
import { Server } from "lucide-react";
import type { DevServer, Project, Task } from "@taskflow/shared";
import type { Scoped } from "@/lib/backend-scope";
import { formatRelativeTime } from "@/lib/relative-time";
import { useBackendStore } from "@/stores/backend-store";
import type { MachineState } from "@/stores/backend-store";
import { devServerKey, useDevServerStore } from "@/stores/dev-server-store";
import { useProjectStore } from "@/stores/project-store";
import { useTaskStore } from "@/stores/task-store";
import { Button } from "../ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";

interface DevServerGroup {
    key: string;
    title: string;
    servers: Scoped<DevServer>[];
}

interface GroupSources {
    projects: Scoped<Project>[];
    tasks: Scoped<Task>[];
    machines: MachineState[];
}

function groupDevServers(
    devServers: Scoped<DevServer>[],
    { projects, tasks, machines }: GroupSources,
): DevServerGroup[] {
    const multiBackend = new Set(devServers.map((d) => d.backendId)).size > 1;
    const sorted = [...devServers].sort(
        (a, b) => new Date(a.registeredAt).getTime() - new Date(b.registeredAt).getTime(),
    );
    const groups = new Map<string, DevServerGroup>();
    for (const server of sorted) {
        // A task that no longer exists leaves its records in the project's group.
        const task = server.taskId
            ? tasks.find((t) => t.backendId === server.backendId && t.id === server.taskId)
            : undefined;
        const key = `${server.backendId}:${server.projectId}:${task?.id ?? ""}`;
        let group = groups.get(key);
        if (!group) {
            const parts: string[] = [];
            if (multiBackend) {
                parts.push(
                    machines.find((m) => m.id === server.backendId)?.displayName ??
                        server.backendId,
                );
            }
            parts.push(
                projects.find((p) => p.backendId === server.backendId && p.id === server.projectId)
                    ?.name ?? server.projectId,
            );
            if (task) parts.push(task.title || task.description || "Untitled");
            group = { key, title: parts.join(" · "), servers: [] };
            groups.set(key, group);
        }
        group.servers.push(server);
    }
    return [...groups.values()];
}

/**
 * Rows from attached machines only: a dropped socket marks its machine offline and resets nothing.
 * The browser dev renderer creates no machine rows, so primary counts as live while it has none.
 */
function useLiveDevServers(): Scoped<DevServer>[] {
    const devServers = useDevServerStore((s) => s.devServers);
    const machines = useBackendStore((s) => s.machines);
    const primaryId = useBackendStore((s) => s.primaryId);
    return useMemo(() => {
        const live = new Set(machines.filter((m) => m.state === "attached").map((m) => m.id));
        if (primaryId && !machines.some((m) => m.id === primaryId)) live.add(primaryId);
        return devServers.filter((d) => live.has(d.backendId));
    }, [devServers, machines, primaryId]);
}

function DevServerList() {
    const devServers = useLiveDevServers();
    const stopStates = useDevServerStore((s) => s.stopStates);
    const stopDevServer = useDevServerStore((s) => s.stopDevServer);
    const projects = useProjectStore((s) => s.projects);
    const liveTasks = useTaskStore((s) => s.tasks);
    const archivedTasks = useTaskStore((s) => s.archivedTasks);
    const machines = useBackendStore((s) => s.machines);

    const groups = useMemo(
        () =>
            groupDevServers(devServers, {
                projects,
                tasks: [...liveTasks, ...archivedTasks],
                machines,
            }),
        [devServers, projects, liveTasks, archivedTasks, machines],
    );

    if (groups.length === 0) {
        return (
            <div className="text-muted-foreground px-3 py-4 text-sm">No dev servers running</div>
        );
    }

    return (
        <div className="max-h-80 overflow-y-auto py-1">
            {groups.map((group) => (
                <div key={group.key}>
                    <div
                        data-dev-server-group=""
                        className="text-muted-foreground truncate px-3 pt-2 pb-1 text-xs">
                        {group.title}
                    </div>
                    <ul>
                        {group.servers.map((server) => {
                            const state = stopStates[devServerKey(server)];
                            const stopping = state === "stopping";
                            const error = typeof state === "object" ? state.error : null;
                            return (
                                <li
                                    key={devServerKey(server)}
                                    data-dev-server-row=""
                                    className="px-3 py-1.5">
                                    <div className="flex items-center gap-2">
                                        <span className="bg-success h-2 w-2 shrink-0 rounded-sm" />
                                        <div className="min-w-0 flex-1">
                                            <p className="text-foreground truncate text-sm">
                                                {server.label}
                                            </p>
                                            <p className="text-muted-foreground text-xs">
                                                pid {server.pid} ·{" "}
                                                {formatRelativeTime(server.registeredAt)}
                                            </p>
                                        </div>
                                        <Button
                                            variant="outline"
                                            size="xs"
                                            disabled={stopping}
                                            onClick={() => void stopDevServer(server)}
                                            className="text-destructive border-destructive/40 shrink-0 [-webkit-app-region:no-drag]">
                                            {stopping ? "Stopping…" : "Stop"}
                                        </Button>
                                    </div>
                                    {error && (
                                        <p className="text-destructive mt-1 pl-4 text-xs">
                                            {error}
                                        </p>
                                    )}
                                </li>
                            );
                        })}
                    </ul>
                </div>
            ))}
        </div>
    );
}

function DevServerButton() {
    const [open, setOpen] = useState(false);
    const count = useLiveDevServers().length;
    const clearStopErrors = useDevServerStore((s) => s.clearStopErrors);

    const handleOpenChange = useCallback(
        (next: boolean) => {
            setOpen(next);
            // On open too: a stop pending at close may have failed since.
            clearStopErrors();
        },
        [clearStopErrors],
    );

    // Stays while open, so stopping the last server doesn't pull the popover's anchor away.
    if (count === 0 && !open) return null;

    return (
        <Popover open={open} onOpenChange={handleOpenChange}>
            <PopoverTrigger asChild>
                <Button
                    variant="ghost"
                    size="icon-xs"
                    aria-label="Dev servers"
                    tooltip="Dev servers"
                    tooltipSide="right"
                    className="relative [-webkit-app-region:no-drag]">
                    <Server className="h-3.5 w-3.5" />
                    {count > 0 && (
                        <span className="bg-success text-success-foreground absolute -top-0.5 -right-0.5 flex h-3 min-w-3 items-center justify-center rounded-full px-0.5 text-[8px] font-medium">
                            {count}
                        </span>
                    )}
                </Button>
            </PopoverTrigger>
            <PopoverContent side="right" align="end" sideOffset={8} className="w-80 p-0">
                <div className="border-border border-b px-3 py-2">
                    <span className="text-sm font-medium">Running dev servers</span>
                </div>
                <DevServerList />
            </PopoverContent>
        </Popover>
    );
}

export { DevServerButton, DevServerList };
