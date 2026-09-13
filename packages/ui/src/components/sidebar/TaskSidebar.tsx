import { useEffect, useState, useCallback, useMemo } from "react";
import { DndContext, closestCenter, PointerSensor, useSensor, useSensors } from "@dnd-kit/core";
import type { DragEndEvent } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy, arrayMove } from "@dnd-kit/sortable";
import { buildReorderedProjectIds } from "@taskflow/shared";
import type { Notification, Project } from "@taskflow/shared";
import { getTaskWorkspaceKey } from "@/hooks/useActiveWorkspace";
import type { Scoped } from "@/lib/backend-scope";
import { requirePrimary, useBackendStore } from "@/stores/backend-store";
import { useProjectStore } from "@/stores/project-store";
import { useTaskStore } from "@/stores/task-store";
import { useNotificationStore } from "@/stores/notification-store";
import { useSessionStore } from "@/stores/session-store";
import { useSettingsStore } from "@/stores/settings-store";
import { SIDEBAR_MAX, updateCollapsedProjectIds, useUIStore } from "@/stores/ui-store";
import { useWsStatus } from "@/providers/ws-context";
import { useSidebarNavigation } from "./hooks/useSidebarNavigation";
import { ProjectGroup } from "./ProjectGroup";
import { MachineSection } from "./MachineSection";
import { groupProjectsByMachine, shownProjects } from "./machine-groups";
import { NoDragSpacer } from "./NoDragSpacer";
import { TaskDropZone } from "./TaskDropZone";
import { NewProjectDialog } from "./NewProjectDialog";
import { NewTaskControl } from "./NewTaskControl";
import NotificationPopover from "./NotificationPopover";
import { useSidebarData } from "./hooks/useSidebarData";
import { UpdateDialog } from "./UpdateDialog";
import type { UpdateStatus } from "./UpdateDialog";
import { OfflineIndicator } from "./OfflineIndicator";
import { SidebarToolbar } from "./SidebarToolbar";
import { MachinesMenu } from "./MachinesMenu";
import { Bell, FolderPlus, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Toolbar } from "@/components/ui/toolbar";

export function TaskSidebar() {
    const { connected } = useWsStatus();
    const { addProject } = useProjectStore();
    const { activeTaskId, setActiveTask } = useTaskStore();
    const setShowArchive = useTaskStore((s) => s.setShowArchive);
    const setShowArchivedProjects = useProjectStore((s) => s.setShowArchivedProjects);
    const sidebarWidth = useUIStore((s) => s.sidebarWidth);
    const narrowSidebar = sidebarWidth <= Math.round(SIDEBAR_MAX * 0.55);
    const [isWindowFullscreen, setIsWindowFullscreen] = useState(false);
    const useIconOnlyActionButtons = narrowSidebar && !isWindowFullscreen;
    const activeProjectId = useUIStore((s) => s.activeProjectId);
    const setActiveProject = useUIStore((s) => s.setActiveProject);
    const setFocusedPanel = useUIStore((s) => s.setFocusedPanel);
    const collapsedProjectIds = useUIStore((s) => s.collapsedProjectIds);
    const setProjectCollapsed = useUIStore((s) => s.setProjectCollapsed);
    const masterWorkspaceActive = useUIStore((s) => s.masterWorkspaceActive);
    const setMasterWorkspaceActive = useUIStore((s) => s.setMasterWorkspaceActive);
    const updateSettings = useSettingsStore((s) => s.updateSettings);
    const compactSidebar = useSettingsStore(
        (s) => s.settings?.layout?.panels?.compactSidebar ?? false,
    );
    const openSettings = useUIStore((s) => s.openSettings);
    const toggleFlowManagement = useUIStore((s) => s.toggleFlowManagement);
    const toggleScheduleManagement = useUIStore((s) => s.toggleScheduleManagement);
    const toggleAppearance = useUIStore((s) => s.toggleAppearance);
    const [newProjectOpen, setNewProjectOpen] = useState(false);
    const [projectError, setProjectError] = useState<string | null>(null);
    const [updateStatus, setUpdateStatus] = useState<UpdateStatus>({ status: "idle" });
    const [updateDialogOpen, setUpdateDialogOpen] = useState(false);
    const [notificationPopoverOpen, setNotificationPopoverOpen] = useState(false);

    const {
        projects,
        tasks,
        displayTasks,
        showArchive,
        showArchivedProjects,
        tasksByProject,
        visibleProjects,
        diffStatsByProject,
        behindByProject,
        notifications,
    } = useSidebarData(connected);

    const unreadCount = notifications.filter((n) => !n.read).length;

    const cmdHeld = useUIStore((s) => s.cmdHeld);
    const focusedPanel = useUIStore((s) => s.focusedPanel);
    const sidebarFocusedItem = useUIStore((s) => s.sidebarFocusedItem);
    const showBadges = cmdHeld && focusedPanel === "sidebar";

    const machines = useBackendStore((s) => s.machines);
    const [collapsedMachineIds, setCollapsedMachineIds] = useState<ReadonlySet<string>>(
        () => new Set(),
    );
    const machineGroups = useMemo(
        () => groupProjectsByMachine(visibleProjects, machines),
        [visibleProjects, machines],
    );
    const shown = useMemo(
        () => shownProjects(machineGroups, collapsedMachineIds),
        [machineGroups, collapsedMachineIds],
    );
    const badgeIndexById = useMemo(() => new Map(shown.map((p, i) => [p.id, i])), [shown]);

    useSidebarNavigation(shown);

    const reorderProjects = useProjectStore((s) => s.reorderProjects);
    const allProjects = useProjectStore((s) => s.projects);
    const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

    const handleProjectDragEnd = useCallback(
        (event: DragEndEvent, listIds: string[]) => {
            const { active, over } = event;
            if (!over || active.id === over.id) return;
            const oldIndex = listIds.indexOf(String(active.id));
            const newIndex = listIds.indexOf(String(over.id));
            if (oldIndex === -1 || newIndex === -1) return;
            // Ordering is per machine, and each machine's list has its own drag
            // context. The local list can still hold several row-less machines'
            // projects (the dev renderer), so a cross-machine drop does nothing.
            const moved = allProjects.find((p) => p.id === String(active.id));
            const target = allProjects.find((p) => p.id === String(over.id));
            if (!moved || !target || moved.backendId !== target.backendId) return;
            const machineIds = new Set(
                allProjects.filter((p) => p.backendId === moved.backendId).map((p) => p.id),
            );
            const reorderedVisible = arrayMove(listIds, oldIndex, newIndex).filter((id) =>
                machineIds.has(id),
            );
            void reorderProjects(
                moved.backendId,
                buildReorderedProjectIds([...machineIds], reorderedVisible),
            );
        },
        [allProjects, reorderProjects],
    );

    const handleMachineOpenChange = useCallback((machineId: string, open: boolean) => {
        setCollapsedMachineIds((current) => {
            const next = new Set(current);
            if (open) next.delete(machineId);
            else next.add(machineId);
            return next;
        });
    }, []);

    useEffect(() => {
        const cleanup = window.taskflow?.onToggleArchive(() => {
            const next = !useTaskStore.getState().showArchive;
            setShowArchive(next);
        });
        return cleanup;
    }, [setShowArchive]);

    useEffect(() => {
        window.taskflow?.sendArchiveState(showArchive);
    }, [showArchive]);

    useEffect(() => {
        const cleanup = window.taskflow?.onToggleArchivedProjects(() => {
            const state = useProjectStore.getState();
            setShowArchivedProjects(!state.showArchivedProjects);
        });
        return cleanup;
    }, [setShowArchivedProjects]);

    useEffect(() => {
        window.taskflow?.sendArchivedProjectsState(showArchivedProjects);
    }, [showArchivedProjects]);

    useEffect(() => {
        const cleanup = window.taskflow?.onToggleCompactSidebar(() => {
            const current =
                useSettingsStore.getState().settings?.layout?.panels?.compactSidebar ?? false;
            const next = !current;
            void useSettingsStore
                .getState()
                .updateSettings({ layout: { panels: { compactSidebar: next } } });
            window.taskflow?.sendCompactSidebarState(next);
        });
        return cleanup;
    }, []);

    useEffect(() => {
        const cleanup = window.taskflow?.onUpdateStatus((payload) => {
            setUpdateStatus({
                status: payload.status as UpdateStatus["status"],
                version: payload.version,
            });
        });
        return cleanup;
    }, []);

    useEffect(() => {
        let cancelled = false;

        void window.taskflow?.getWindowFullscreen?.().then((fullscreen) => {
            if (!cancelled) {
                setIsWindowFullscreen(fullscreen);
            }
        });

        const cleanup = window.taskflow?.onWindowFullscreenChanged?.((fullscreen) => {
            setIsWindowFullscreen(fullscreen);
        });

        return () => {
            cancelled = true;
            cleanup?.();
        };
    }, []);

    const handleOpenProjectDialog = useCallback(() => {
        setProjectError(null);
        setNewProjectOpen(true);
    }, []);

    const handleProjectSubmit = useCallback(
        async (path: string) => {
            try {
                setProjectError(null);
                // Add Project stays on primary; Task 19 gates it per target.
                await addProject(requirePrimary(), path);
                setNewProjectOpen(false);
            } catch (err) {
                setProjectError(err instanceof Error ? err.message : "Failed to add project");
            }
        },
        [addProject],
    );

    const handleProjectDialogChange = useCallback((open: boolean) => {
        if (!open) setProjectError(null);
        setNewProjectOpen(open);
    }, []);

    const handleMasterWorkspace = useCallback(() => {
        setActiveTask(null);
        setActiveProject(null);
        setMasterWorkspaceActive(true);
    }, [setActiveTask, setActiveProject, setMasterWorkspaceActive]);

    const handleProjectClick = useCallback(
        (projectId: string) => {
            setFocusedPanel("workspace");
            setActiveProject(projectId);
            setActiveTask(null);
            setMasterWorkspaceActive(false);
        },
        [setActiveProject, setActiveTask, setFocusedPanel, setMasterWorkspaceActive],
    );

    const handleTaskClick = useCallback(
        (taskId: string) => {
            const task = tasks.find((entry) => entry.id === taskId);
            setFocusedPanel("workspace");
            setActiveTask(taskId);
            setActiveProject(task?.projectId ?? null);
            setMasterWorkspaceActive(false);
        },
        [setActiveProject, setActiveTask, setFocusedPanel, setMasterWorkspaceActive, tasks],
    );

    const handleProjectOpenChange = useCallback(
        (projectId: string, open: boolean) => {
            const nextCollapsedProjectIds = updateCollapsedProjectIds(
                useUIStore.getState().collapsedProjectIds,
                projectId,
                !open,
            );
            setProjectCollapsed(projectId, !open);
            void updateSettings({
                layout: {
                    panels: {
                        collapsedProjectIds: nextCollapsedProjectIds,
                    },
                },
            });
        },
        [setProjectCollapsed, updateSettings],
    );

    const handleNotificationNavigate = useCallback(
        (
            notification: Pick<
                Scoped<Notification>,
                "backendId" | "projectId" | "taskId" | "sessionId"
            >,
        ) => {
            // The notification's own machine holds its project and task.
            const project = projects.find(
                (p) => p.backendId === notification.backendId && p.id === notification.projectId,
            );
            if (!project) return;

            setFocusedPanel("workspace");
            setActiveProject(notification.projectId);

            if (notification.taskId) {
                const task = tasks.find(
                    (t) => t.backendId === notification.backendId && t.id === notification.taskId,
                );
                if (!task) return;
                setActiveTask(task.id);

                if (notification.sessionId) {
                    const sessionExists = task.sessions.some(
                        (s) => s.id === notification.sessionId,
                    );
                    if (sessionExists) {
                        const workspaceKey = getTaskWorkspaceKey(task.id);
                        useSessionStore
                            .getState()
                            .setActiveTab(workspaceKey, notification.sessionId);
                    }
                }
            } else {
                setActiveTask(null);
            }
        },
        [projects, tasks, setFocusedPanel, setActiveProject, setActiveTask],
    );

    useEffect(() => {
        const cleanup = window.taskflow?.onNotificationClicked?.((payload) => {
            if (!payload.id) return;
            const store = useNotificationStore.getState();
            const notification = store.notifications.find(
                (n) => n.backendId === payload.backendId && n.id === payload.id,
            );
            if (notification) void store.markAsRead(notification);
            useNotificationStore.getState().setSelectedNotificationId(payload.id);
        });
        return cleanup;
    }, []);

    /** One machine's projects, in a drag context of their own: order is per machine. */
    const renderProjectList = (list: Scoped<Project>[]) => {
        const listIds = list.map((p) => p.id);
        return (
            <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragEnd={(event) => handleProjectDragEnd(event, listIds)}>
                <SortableContext items={listIds} strategy={verticalListSortingStrategy}>
                    {list.map((project, index) => {
                        const projectTasks = tasksByProject.get(project.id) ?? [];
                        const projectOpen = !collapsedProjectIds.includes(project.id);

                        let taskKeyBadges: Record<string, number> | undefined;
                        let projectBadgeNumber: number | undefined;

                        if (showBadges) {
                            if (!sidebarFocusedItem || sidebarFocusedItem.type === "project") {
                                const badgeIndex = badgeIndexById.get(project.id);
                                projectBadgeNumber =
                                    badgeIndex !== undefined && badgeIndex < 9
                                        ? badgeIndex + 1
                                        : undefined;
                            } else if (sidebarFocusedItem.type === "task") {
                                const focusedTask = displayTasks.find(
                                    (t) => t.id === sidebarFocusedItem.id,
                                );
                                if (focusedTask && focusedTask.projectId === project.id) {
                                    taskKeyBadges = {};
                                    let badgeIndex = 0;
                                    for (const task of projectTasks) {
                                        if (!task.parentId) {
                                            if (badgeIndex < 9) {
                                                taskKeyBadges[task.id] = badgeIndex + 1;
                                            }
                                            badgeIndex++;
                                        }
                                    }
                                }
                            }
                        }

                        return (
                            <TaskDropZone
                                key={project.id}
                                projectId={project.id}
                                enabled={!project.hidden}>
                                {index > 0 && <NoDragSpacer />}
                                <ProjectGroup
                                    project={project}
                                    tasks={projectTasks}
                                    activeTaskId={activeTaskId}
                                    isActive={!activeTaskId && activeProjectId === project.id}
                                    diffStats={diffStatsByProject[project.id]}
                                    diffStatsByTask={diffStatsByProject}
                                    behind={behindByProject[project.id] ?? 0}
                                    behindByTask={behindByProject}
                                    keyBadgeNumber={projectBadgeNumber}
                                    taskKeyBadges={taskKeyBadges}
                                    onProjectClick={handleProjectClick}
                                    onTaskClick={handleTaskClick}
                                    archived={showArchive}
                                    compact={compactSidebar}
                                    open={projectOpen}
                                    onOpenChange={(open) =>
                                        handleProjectOpenChange(project.id, open)
                                    }
                                />
                            </TaskDropZone>
                        );
                    })}
                </SortableContext>
            </DndContext>
        );
    };

    return (
        <>
            <Toolbar className="justify-between gap-2 border-none">
                <div className="flex flex-1 items-center justify-end gap-1">
                    {showArchive ? (
                        <span className="text-muted-foreground px-1 text-xs font-medium">
                            Archived Tasks
                        </span>
                    ) : (
                        <>
                            <NewTaskControl
                                tooltipSide="bottom"
                                iconOnly={useIconOnlyActionButtons}
                            />
                            <Button
                                variant="ghost"
                                size={useIconOnlyActionButtons ? "icon-xs" : "xs"}
                                onClick={() => handleOpenProjectDialog()}
                                tooltip={useIconOnlyActionButtons ? "New project" : undefined}
                                tooltipSide="bottom"
                                className="[-webkit-app-region:no-drag]">
                                {useIconOnlyActionButtons ? (
                                    <FolderPlus className="h-4 w-4" />
                                ) : (
                                    <>
                                        <Plus className="h-4 w-4" />
                                        Project
                                    </>
                                )}
                            </Button>
                        </>
                    )}
                </div>
            </Toolbar>
            <TaskDropZone className="flex-1 overflow-x-hidden overflow-y-auto pt-0.5 pb-1">
                {!showArchive &&
                    machineGroups.local.length === 0 &&
                    machineGroups.remote.length === 0 && (
                        <div className="text-muted-foreground p-3 text-sm">
                            <div className="mb-2">
                                {projects.length === 0 ? "No projects yet." : "No active projects."}
                            </div>
                            <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => handleOpenProjectDialog()}
                                className="text-accent text-sm [-webkit-app-region:no-drag]">
                                Add Project
                            </Button>
                        </div>
                    )}
                {showArchive && displayTasks.length === 0 && (
                    <div className="text-muted-foreground p-3 text-sm">No archived tasks.</div>
                )}
                {renderProjectList(machineGroups.local)}
                {machineGroups.remote.map(({ machine, projects: machineProjects }) => (
                    <MachineSection
                        key={machine.id}
                        machine={machine}
                        projects={machineProjects}
                        open={!collapsedMachineIds.has(machine.id)}
                        onOpenChange={(open) => handleMachineOpenChange(machine.id, open)}
                        renderProjects={renderProjectList}
                    />
                ))}
            </TaskDropZone>
            {/* <Separator /> */}
            <Toolbar noBorder className="justify-between">
                <div className="flex items-center">
                    <MachinesMenu
                        masterWorkspaceActive={masterWorkspaceActive}
                        onMasterWorkspace={handleMasterWorkspace}
                    />
                    {notifications.length > 0 && (
                        <NotificationPopover
                            open={notificationPopoverOpen}
                            onOpenChange={setNotificationPopoverOpen}
                            onNavigate={handleNotificationNavigate}>
                            <Button
                                variant="ghost"
                                size="icon-xs"
                                aria-label="Notifications"
                                tooltip="Notifications"
                                tooltipSide="right"
                                className="relative [-webkit-app-region:no-drag]">
                                <Bell className="h-3.5 w-3.5" />
                                {unreadCount > 0 && (
                                    <span className="bg-accent text-accent-foreground absolute -top-0.5 -right-0.5 flex h-3 min-w-3 items-center justify-center rounded-full px-0.5 text-[8px] font-medium">
                                        {unreadCount}
                                    </span>
                                )}
                            </Button>
                        </NotificationPopover>
                    )}
                    <OfflineIndicator />
                    <UpdateDialog
                        updateStatus={updateStatus}
                        dialogOpen={updateDialogOpen}
                        onDialogOpenChange={setUpdateDialogOpen}
                    />
                </div>
                <SidebarToolbar
                    onFlows={toggleFlowManagement}
                    onSchedules={toggleScheduleManagement}
                    onAppearance={toggleAppearance}
                    onSettings={openSettings}
                />
            </Toolbar>
            <NewProjectDialog
                open={newProjectOpen}
                onOpenChange={handleProjectDialogChange}
                onSubmit={(path) => void handleProjectSubmit(path)}
                error={projectError}
            />
        </>
    );
}
