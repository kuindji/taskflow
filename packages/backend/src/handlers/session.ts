import { MSG } from "@taskflow/shared";
import type {
    SessionCreatePayload,
    SessionResumePayload,
    SessionClosePayload,
    SessionRenamePayload,
    SessionInputPayload,
    SessionHistoryPayload,
    SessionSnapshotPayload,
    TerminalResizePayload,
    SessionRef,
} from "@taskflow/shared";
import type { Router } from "../ws/router";
import type { PtyManager } from "../services/pty-manager";
import type { TaskStore } from "../services/task-store";
import type { createSessionLifecycle } from "../services/session-lifecycle";

interface SessionHandlerDeps {
    router: Router;
    ptyManager: PtyManager;
    taskStore: TaskStore;
    sessionLifecycle: ReturnType<typeof createSessionLifecycle>;
}

export function registerSessionHandlers(deps: SessionHandlerDeps): void {
    const { router, ptyManager, taskStore, sessionLifecycle } = deps;

    router.register(MSG.SESSION_CREATE, async (payload) => {
        const {
            taskId,
            projectId,
            master,
            type,
            label,
            prompt,
            shell,
            cwd,
            cols,
            rows,
            agentOptions,
            editorId,
            filePath,
            line,
        } = payload as SessionCreatePayload;
        const sessionId = await sessionLifecycle.createSession({
            owner: { taskId, projectId, master },
            type,
            label,
            prompt,
            shell,
            cwd,
            agentOptions,
            cols,
            rows,
            editorId,
            filePath,
            line,
        });
        return { sessionId };
    });

    router.register(MSG.SESSION_INPUT, async (payload) => {
        const { sessionId, data } = payload as SessionInputPayload;
        ptyManager.write(sessionId, data);
        return { success: true };
    });

    router.register(MSG.SESSION_RESUME, async (payload) => {
        const { sessionId } = payload as SessionResumePayload;
        return { sessionId: await sessionLifecycle.resumeSession(sessionId) };
    });

    router.register(MSG.SESSION_CLOSE, async (payload) => {
        const { sessionId } = payload as SessionClosePayload;
        await sessionLifecycle.removeSessionFromOwner(sessionId);
        ptyManager.close(sessionId);
        return { success: true };
    });

    router.register(MSG.SESSION_RENAME, async (payload) => {
        const { sessionId, label } = payload as SessionRenamePayload;

        const updateLabel = (sessions: SessionRef[]) =>
            sessions.map((s) => (s.id === sessionId ? { ...s, label } : s));

        const tasks = await taskStore.listTasks();
        const ownerTask = tasks.find((t) => t.sessions.some((s) => s.id === sessionId));
        if (ownerTask) {
            await taskStore.updateTask(ownerTask.id, (task) => ({
                sessions: updateLabel(task.sessions),
            }));
            return { success: true };
        }

        const projects = await taskStore.listProjects();
        const ownerProject = projects.find((p) => p.sessions.some((s) => s.id === sessionId));
        if (ownerProject) {
            await taskStore.updateProject(ownerProject.id, (project) => ({
                sessions: updateLabel(project.sessions),
            }));
            return { success: true };
        }

        // Check master sessions
        const masterSessions = taskStore.getMasterSessions();
        if (masterSessions.some((s) => s.id === sessionId)) {
            await taskStore.updateMasterSession(sessionId, { label });
            return { success: true };
        }

        throw new Error(`Session not found: ${sessionId}`);
    });

    router.register(MSG.TERMINAL_RESIZE, async (payload) => {
        const { sessionId, cols, rows } = payload as TerminalResizePayload;
        ptyManager.resize(sessionId, cols, rows);
        return { success: true };
    });

    router.register(MSG.SESSION_HISTORY, async (payload) => {
        const { taskId, projectId, master, sessionId } = payload as SessionHistoryPayload;
        const ownerId = master ? "master" : (taskId ?? projectId);
        if (!ownerId || (!master && taskId && projectId)) {
            throw new Error("Exactly one of taskId, projectId, or master is required");
        }
        return taskStore.getSessionHistory(ownerId, sessionId);
    });

    router.register(MSG.SESSION_SNAPSHOT, async (payload) => {
        const { sessionId } = payload as SessionSnapshotPayload;
        return ptyManager.getSnapshot(sessionId);
    });

    router.register(MSG.MASTER_SESSIONS_LIST, async () => {
        return { sessions: taskStore.getMasterSessions() };
    });
}
