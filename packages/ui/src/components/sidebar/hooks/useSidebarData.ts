import { useEffect, useMemo, useRef } from "react";
import type { Task, TaskWorktreePr, MasterSessionsListResponse } from "@taskflow/shared";
import { MSG } from "@taskflow/shared";
import { prefetchHomedir } from "@/hooks/useActiveWorkspace";
import type { Scoped } from "@/lib/backend-scope";
import { getPrimary, sendRequest as sendRequestTo } from "@/lib/connection-registry";
import { useBackendStore } from "@/stores/backend-store";
import { useProjectStore } from "@/stores/project-store";
import { useTaskStore } from "@/stores/task-store";
import { useSessionStore } from "@/stores/session-store";
import { useSettingsStore } from "@/stores/settings-store";
import { useDiffStore } from "@/stores/diff-store";
import { useThemeStore } from "@/stores/theme-store";
import { useNotificationStore } from "@/stores/notification-store";

/** Each machine's records, with an empty list for a machine that holds none. */
function recordsByBackend<T extends { backendId: string }>(
    backendIds: readonly string[],
    records: readonly T[],
): Map<string, T[]> {
    const map = new Map<string, T[]>(backendIds.map((id) => [id, []]));
    for (const record of records) map.get(record.backendId)?.push(record);
    return map;
}

function useSidebarData(connected: boolean) {
    const projects = useProjectStore((s) => s.projects);
    const showArchivedProjects = useProjectStore((s) => s.showArchivedProjects);
    const tasks = useTaskStore((s) => s.tasks);
    const archivedTasks = useTaskStore((s) => s.archivedTasks);
    const showArchive = useTaskStore((s) => s.showArchive);
    const machines = useBackendStore((s) => s.machines);
    const primaryId = useBackendStore((s) => s.primaryId);
    const bootstrapBackend = useBackendStore((s) => s.bootstrapBackend);
    const syncWithTasks = useSessionStore((s) => s.syncWithTasks);
    const syncWithProjects = useSessionStore((s) => s.syncWithProjects);
    const syncWithMasterSessions = useSessionStore((s) => s.syncWithMasterSessions);
    const fetchSettings = useSettingsStore((s) => s.fetchSettings);
    const fetchThemes = useThemeStore((s) => s.fetchThemes);
    const diffStatsByProject = useDiffStore((s) => s.statsByProject);
    const behindByProject = useDiffStore((s) => s.behindByProject);
    const notifications = useNotificationStore((s) => s.notifications);
    const updateTask = useTaskStore((s) => s.updateTask);

    // Initial data fetch
    useEffect(() => {
        if (!connected) return;
        // `connected` follows primary. An attach bootstraps its own machine; this
        // covers the dev renderer, which attaches nothing, and primary's reconnects.
        const primary = getPrimary();
        if (primary) void bootstrapBackend(primary);
        prefetchHomedir();

        void (async () => {
            // The theme choice is a setting, so themes wait for primary's settings.
            try {
                if (primary) await fetchSettings(primary);
            } catch {
                // Keep existing defaults if settings are temporarily unavailable.
            }

            try {
                await fetchThemes();
            } catch {
                // Theme store already has a bundled fallback; keep the app usable.
            }
        })();
    }, [connected, bootstrapBackend, fetchSettings, fetchThemes]);

    // Every machine the sidebar knows of, including one that holds no records
    // any more (its last task's tabs still need pruning) and the dev renderer's
    // primary, which has no machine row.
    const backendIds = useMemo(() => {
        const ids = new Set(machines.map((machine) => machine.id));
        if (primaryId) ids.add(primaryId);
        for (const record of [...projects, ...tasks]) ids.add(record.backendId);
        return [...ids];
    }, [machines, primaryId, projects, tasks]);

    // Sync sessions with tasks/projects, one machine at a time: a sync rebuilds
    // only its own machine's workspaces.
    const tasksByBackend = useMemo(() => recordsByBackend(backendIds, tasks), [backendIds, tasks]);
    useEffect(() => {
        for (const [backendId, list] of tasksByBackend) syncWithTasks(backendId, list);
    }, [tasksByBackend, syncWithTasks]);

    const projectsByBackend = useMemo(
        () => recordsByBackend(backendIds, projects),
        [backendIds, projects],
    );
    useEffect(() => {
        for (const [backendId, list] of projectsByBackend) syncWithProjects(backendId, list);
    }, [projectsByBackend, syncWithProjects]);

    // Fetch master sessions: the master workspace is primary's.
    useEffect(() => {
        if (!connected) return;
        const primary = getPrimary();
        if (!primary) return;
        sendRequestTo<MasterSessionsListResponse>(primary, MSG.MASTER_SESSIONS_LIST, {})
            .then((res) => syncWithMasterSessions(primary, res.sessions))
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
    const prCheckTasksRef = useRef<Scoped<Task>[]>(prCheckTasks);
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
                    // The worktree path is the task's machine's: asked anywhere
                    // else, a checkout at the same path could answer for it.
                    const result = await sendRequestTo<{ pr: TaskWorktreePr | null }>(
                        task.backendId,
                        MSG.GIT_CHECK_PR,
                        { path: task.worktree.path, branch: task.worktree.branch },
                    );
                    if (result.pr) {
                        await updateTask(task, {
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

    const displayTasks = showArchive ? archivedTasks : tasks;

    const tasksByProject = useMemo(() => {
        const map = new Map<string, Scoped<Task>[]>();
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
