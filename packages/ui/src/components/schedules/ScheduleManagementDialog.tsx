import { useState, useEffect, useCallback, useMemo } from "react";
import type { Schedule, ScheduleCreatePayload, ScheduleUpdatePayload } from "@taskflow/shared";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Switch } from "@/components/ui/switch";
import { ConfirmDeleteDialog } from "@/components/ui/confirm-delete-dialog";
import { Plus, Play, MoreHorizontal, CalendarClock } from "lucide-react";
import { useUIStore } from "@/stores/ui-store";
import { useScheduleStore } from "@/stores/schedule-store";
import { useProjectStore } from "@/stores/project-store";
import { useFlowStore, filterByProject } from "@/stores/flow-store";
import { ScheduleForm } from "./ScheduleForm";
import { cn } from "@/lib/utils";

function formatRelativeTime(dateStr: string | null): string {
    if (!dateStr) return "Never";
    const diff = Date.now() - new Date(dateStr).getTime();
    if (diff < 0) return "Just now";
    const seconds = Math.floor(diff / 1000);
    if (seconds < 60) return `${seconds}s ago`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
}

type ScheduleStatus = "running" | "error" | "idle";

function getScheduleStatus(schedule: Schedule): ScheduleStatus {
    if (schedule.runningSessionId) return "running";
    if (schedule.lastError) return "error";
    return "idle";
}

const statusColors: Record<ScheduleStatus, string> = {
    running: "bg-blue-500",
    error: "bg-red-500",
    idle: "bg-green-500",
};

function ScheduleManagementDialog() {
    const open = useUIStore((s) => s.scheduleManagementOpen);
    const toggleScheduleManagement = useUIStore((s) => s.toggleScheduleManagement);

    const schedules = useScheduleStore((s) => s.schedules);
    const projects = useProjectStore((s) => s.projects);
    const allActions = useFlowStore((s) => s.actions);
    const activeProjectId = useUIStore((s) => s.activeProjectId);

    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [creating, setCreating] = useState(false);
    const [projectFilter, setProjectFilter] = useState<string>(activeProjectId ?? "all");
    const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);

    useEffect(() => {
        if (!open) return;
        void useScheduleStore.getState().fetchSchedules();
        void useFlowStore.getState().fetchActions();
    }, [open]);

    const projectMap = useMemo(() => new Map(projects.map((p) => [p.id, p.name])), [projects]);
    const actionMap = useMemo(() => new Map(allActions.map((a) => [a.id, a])), [allActions]);

    const filteredSchedules = useMemo(() => {
        if (projectFilter === "all") return schedules;
        return schedules.filter((s) => s.projectId === projectFilter);
    }, [schedules, projectFilter]);

    const defaultProjectId = projectFilter !== "all" ? projectFilter : undefined;

    const selectedSchedule = filteredSchedules.find((s) => s.id === selectedId) ?? null;

    const formProjectId = selectedSchedule?.projectId ?? defaultProjectId;
    const formActions = useMemo(
        () => filterByProject(allActions, formProjectId).filter((a) => a.standalone),
        [allActions, formProjectId],
    );

    const handleOpenChange = useCallback(
        (value: boolean) => {
            if (!value) toggleScheduleManagement();
        },
        [toggleScheduleManagement],
    );

    const handleSave = useCallback(
        async (payload: ScheduleCreatePayload | ScheduleUpdatePayload) => {
            if ("id" in payload) {
                const updated = await useScheduleStore.getState().updateSchedule(payload);
                setSelectedId(updated.id);
            } else {
                const created = await useScheduleStore.getState().createSchedule(payload);
                setSelectedId(created.id);
            }
            setCreating(false);
        },
        [],
    );

    const handleDelete = useCallback(async (id: string) => {
        await useScheduleStore.getState().deleteSchedule(id);
        setSelectedId(null);
        setCreating(false);
    }, []);

    const handleToggleEnabled = useCallback(async (schedule: Schedule) => {
        await useScheduleStore.getState().updateSchedule({
            id: schedule.id,
            enabled: !schedule.enabled,
        });
    }, []);

    const handleTrigger = useCallback(async (id: string) => {
        await useScheduleStore.getState().triggerSchedule(id);
    }, []);

    const startCreating = useCallback(() => {
        setSelectedId(null);
        setCreating(true);
    }, []);

    const selectItem = useCallback((id: string) => {
        setSelectedId(id);
        setCreating(false);
    }, []);

    const clearSelection = useCallback(() => {
        setCreating(false);
        setSelectedId(null);
    }, []);

    return (
        <Dialog open={open} onOpenChange={handleOpenChange}>
            <DialogContent
                className="bg-dialog-shell border-border w-4xl max-w-[calc(100vw-2rem)] gap-0 rounded-xl p-1.5 sm:max-w-[calc(100vw-2rem)]"
                aria-describedby={undefined}>
                <DialogHeader className="px-2 py-2">
                    <DialogTitle className="text-[15px]">Schedules</DialogTitle>
                </DialogHeader>

                <div className="flex h-[60vh] gap-1.5">
                    {/* Left list column */}
                    <div className="bg-card flex w-[260px] shrink-0 flex-col rounded-[10px]">
                        <div className="p-2">
                            <Select
                                value={projectFilter}
                                onValueChange={(v) => {
                                    setProjectFilter(v);
                                    setSelectedId(null);
                                    setCreating(false);
                                }}>
                                <SelectTrigger className="h-7 w-full text-xs">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="all">All Projects</SelectItem>
                                    {projects.map((p) => (
                                        <SelectItem key={p.id} value={p.id}>
                                            {p.name}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>

                        <div className="flex-1 overflow-y-auto px-1.5 py-0.5">
                            {filteredSchedules.map((s) => {
                                const status = getScheduleStatus(s);
                                return (
                                    <button
                                        key={s.id}
                                        onClick={() => selectItem(s.id)}
                                        className={cn(
                                            `mb-0.5 w-full rounded-md px-2.5 py-2 text-left text-[13px] transition-colors`,
                                            selectedId === s.id
                                                ? "bg-muted text-foreground font-medium"
                                                : "text-secondary-foreground hover:bg-muted/50",
                                        )}>
                                        <div className="flex items-center gap-2">
                                            <span
                                                className={`h-2 w-2 shrink-0 rounded-full ${statusColors[status]}`}
                                                title={status}
                                            />
                                            <span className="truncate font-medium">
                                                {s.name || s.prompt.slice(0, 40)}
                                            </span>
                                        </div>
                                        <div className="text-muted-foreground mt-1 flex items-center gap-1.5 text-[11px]">
                                            <span className="truncate">{s.expression}</span>
                                            <span>&middot;</span>
                                            <span className="shrink-0">
                                                {formatRelativeTime(s.lastRunAt)}
                                            </span>
                                        </div>
                                        {s.actionId && (
                                            <div className="text-muted-foreground mt-0.5 text-[11px]">
                                                <span className="bg-muted truncate rounded px-1">
                                                    {actionMap.get(s.actionId)?.name ??
                                                        "Unknown action"}
                                                </span>
                                            </div>
                                        )}
                                        {projectFilter === "all" && (
                                            <div className="text-muted-foreground mt-0.5 text-[11px]">
                                                <span className="bg-muted truncate rounded px-1">
                                                    {projectMap.get(s.projectId) ?? "Unknown"}
                                                </span>
                                            </div>
                                        )}
                                        <div
                                            className="mt-1.5 flex items-center gap-1.5"
                                            onClick={(e) => e.stopPropagation()}>
                                            <Switch
                                                checked={s.enabled}
                                                onCheckedChange={() => void handleToggleEnabled(s)}
                                                className="scale-75"
                                            />
                                            <DropdownMenu>
                                                <DropdownMenuTrigger asChild>
                                                    <button
                                                        className="text-muted-foreground hover:text-foreground rounded p-0.5"
                                                        title="Actions">
                                                        <MoreHorizontal className="h-3.5 w-3.5" />
                                                    </button>
                                                </DropdownMenuTrigger>
                                                <DropdownMenuContent align="start">
                                                    <DropdownMenuItem
                                                        onClick={() => void handleTrigger(s.id)}>
                                                        <Play className="mr-2 h-3.5 w-3.5" />
                                                        Run now
                                                    </DropdownMenuItem>
                                                    <DropdownMenuItem
                                                        className="text-destructive"
                                                        onClick={() => setPendingDeleteId(s.id)}>
                                                        Delete
                                                    </DropdownMenuItem>
                                                </DropdownMenuContent>
                                            </DropdownMenu>
                                        </div>
                                    </button>
                                );
                            })}
                            {filteredSchedules.length === 0 && (
                                <div className="text-muted-foreground px-3 py-6 text-center text-xs">
                                    No schedules yet
                                </div>
                            )}
                        </div>

                        <div className="flex justify-end p-1">
                            <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7"
                                onClick={startCreating}
                                title="New schedule">
                                <Plus className="h-4 w-4" />
                            </Button>
                        </div>
                    </div>

                    {/* Right form column */}
                    <div className="bg-background flex min-h-0 min-w-0 flex-1 flex-col rounded-[10px]">
                        {creating || selectedSchedule ? (
                            <ScheduleForm
                                key={
                                    creating
                                        ? `new-schedule-${defaultProjectId ?? "none"}`
                                        : selectedSchedule?.id
                                }
                                schedule={creating ? null : selectedSchedule}
                                projects={projects}
                                actions={formActions}
                                defaultProjectId={defaultProjectId}
                                onSave={handleSave}
                                onCancel={clearSelection}
                                onDelete={
                                    selectedSchedule
                                        ? () => void handleDelete(selectedSchedule.id)
                                        : undefined
                                }
                            />
                        ) : (
                            <div className="text-muted-foreground flex h-full flex-col items-center justify-center gap-2 text-sm">
                                <CalendarClock className="h-8 w-8 opacity-40" />
                                <span>
                                    Select a schedule or click{" "}
                                    <Plus className="mx-0.5 inline h-4 w-4" /> to create
                                </span>
                            </div>
                        )}
                    </div>
                </div>
            </DialogContent>
            <ConfirmDeleteDialog
                open={pendingDeleteId !== null}
                onOpenChange={(open) => {
                    if (!open) setPendingDeleteId(null);
                }}
                onConfirm={() => {
                    if (pendingDeleteId) {
                        void handleDelete(pendingDeleteId);
                        setPendingDeleteId(null);
                    }
                }}
                title="Delete this schedule?"
            />
        </Dialog>
    );
}

export { ScheduleManagementDialog };
