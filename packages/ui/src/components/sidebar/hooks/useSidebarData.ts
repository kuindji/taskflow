import { useEffect, useMemo, useRef } from "react";
import type { Task, TaskWorktreePr, MasterSessionsListResponse } from "@taskflow/shared";
import { MSG } from "@taskflow/shared";
import { sendRequest } from "@/hooks/useWebSocket";
import { prefetchHomedir } from "@/hooks/useActiveWorkspace";
import { useProjectStore } from "@/stores/project-store";
import { useTaskStore } from "@/stores/task-store";
import { useSessionStore } from "@/stores/session-store";
import { useSettingsStore } from "@/stores/settings-store";
import { useFlowStore } from "@/stores/flow-store";
import { useDiffStore } from "@/stores/diff-store";
import { useThemeStore } from "@/stores/theme-store";
import { useNotificationStore } from "@/stores/notification-store";

function useSidebarData(connected: boolean) {
    const { projects, fetchProjects } = useProjectStore();
    const showArchivedProjects = useProjectStore((s) => s.showArchivedProjects);
    const { tasks, fetchTasks } = useTaskStore();
    const archivedTasks = useTaskStore((s) => s.archivedTasks);
    const showArchive = useTaskStore((s) => s.showArchive);
    const syncWithTasks = useSessionStore((s) => s.syncWithTasks);
    const syncWithProjects = useSessionStore((s) => s.syncWithProjects);
    const syncWithMasterSessions = useSessionStore((s) => s.syncWithMasterSessions);
    const fetchSettings = useSettingsStore((s) => s.fetchSettings);
    const fetchThemes = useThemeStore((s) => s.fetchThemes);
    const diffStatsByProject = useDiffStore((s) => s.statsByProject);
    const behindByProject = useDiffStore((s) => s.behindByProject);
    const notifications = useNotificationStore((s) => s.notifications);
    const fetchNotifications = useNotificationStore((s) => s.fetchNotifications);
    const updateTask = useTaskStore((s) => s.updateTask);

    // Initial data fetch
    useEffect(() => {
        if (!connected) return;
        void fetchProjects();
        void fetchTasks();
        void useFlowStore.getState().fetchFlows();
        void useFlowStore.getState().fetchActions();
        prefetchHomedir();

        void (async () => {
            try {
                await fetchSettings();
            } catch {
                // Keep existing defaults if settings are temporarily unavailable.
            }

            try {
                await fetchThemes();
            } catch {
                // Theme store already has a bundled fallback; keep the app usable.
            }
        })();
    }, [connected, fetchProjects, fetchTasks, fetchSettings, fetchThemes]);

    // Sync sessions with tasks/projects
    useEffect(() => {
        syncWithTasks(tasks);
    }, [tasks, syncWithTasks]);

    useEffect(() => {
        syncWithProjects(projects);
    }, [projects, syncWithProjects]);

    // Fetch master sessions
    useEffect(() => {
        if (!connected) return;
        sendRequest<MasterSessionsListResponse>(MSG.MASTER_SESSIONS_LIST, {})
            .then((res) => syncWithMasterSessions(res.sessions))
            .catch(() => {});
    }, [connected, syncWithMasterSessions]);

    // Poll for PRs on worktree tasks
    const prCheckTasks = useMemo(
        () =>
            tasks.filter(
                (t) => t.worktree.enabled && t.worktree.branch && !t.worktree.pr && !t.parentId,
            ),
        [tasks],
    );
    const prCheckTasksRef = useRef<Task[]>(prCheckTasks);
    useEffect(() => {
        prCheckTasksRef.current = prCheckTasks;
    }, [prCheckTasks]);

    useEffect(() => {
        if (!connected) return;

        async function checkPrs() {
            const tasksToCheck = prCheckTasksRef.current;
            if (tasksToCheck.length === 0) return;

            for (const task of tasksToCheck) {
                if (!task.worktree.path || !task.worktree.branch) continue;
                try {
                    const result = await sendRequest<{ pr: TaskWorktreePr | null }>(
                        MSG.GIT_CHECK_PR,
                        { path: task.worktree.path, branch: task.worktree.branch },
                    );
                    if (result.pr) {
                        await updateTask(task.id, {
                            worktree: { ...task.worktree, pr: result.pr },
                        });
                    }
                } catch {
                    // Silently skip — will retry next cycle
                }
            }
        }

        void checkPrs();
        const interval = setInterval(() => void checkPrs(), 30_000);
        return () => clearInterval(interval);
    }, [connected, updateTask]);

    // Fetch notifications
    useEffect(() => {
        if (!connected) return;
        void fetchNotifications();
    }, [connected, fetchNotifications]);

    const displayTasks = showArchive ? archivedTasks : tasks;

    const tasksByProject = useMemo(() => {
        const map = new Map<string, Task[]>();
        for (const task of displayTasks) {
            const list = map.get(task.projectId) ?? [];
            list.push(task);
            map.set(task.projectId, list);
        }
        return map;
    }, [displayTasks]);

    const visibleProjects = useMemo(
        () =>
            projects.filter((project) => {
                if (project.hidden && !showArchivedProjects) return false;
                if (!showArchive) return true;
                return (tasksByProject.get(project.id) ?? []).length > 0;
            }),
        [projects, showArchive, showArchivedProjects, tasksByProject],
    );

    return {
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
    };
}

export { useSidebarData };
