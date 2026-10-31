import { MSG } from "@taskflow/shared";
import type {
    SessionCreatePayload,
    SessionResumePayload,
    SessionClosePayload,
    SessionRenamePayload,
    SessionMovePayload,
    SessionInputPayload,
    SessionHistoryPayload,
    SessionSnapshotPayload,
    TerminalResizePayload,
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
        const { sessionId, cols, rows } = payload as SessionResumePayload;
        return { sessionId: await sessionLifecycle.resumeSession(sessionId, cols, rows) };
    });

    router.register(MSG.SESSION_CLOSE, async (payload) => {
        const { sessionId } = payload as SessionClosePayload;
        await sessionLifecycle.closeClientSession(sessionId);
        return { success: true };
    });

    router.register(MSG.SESSION_RENAME, async (payload) => {
        const { sessionId, label } = payload as SessionRenamePayload;
        if (!(await sessionLifecycle.renameSession(sessionId, label))) {
            throw new Error(`Session not found: ${sessionId}`);
        }
        return { success: true };
    });

    router.register(MSG.SESSION_MOVE, async (payload) => {
        const { sessionId, taskId, projectId, master } = payload as SessionMovePayload;
        await sessionLifecycle.moveSession(sessionId, { taskId, projectId, master });
        return { success: true };
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
        return sessionLifecycle.readSessionHistory(sessionId, ownerId);
    });

    router.register(MSG.SESSION_SNAPSHOT, async (payload) => {
        const { sessionId } = payload as SessionSnapshotPayload;
        return await ptyManager.getSnapshot(sessionId);
    });

    router.register(MSG.MASTER_SESSIONS_LIST, async () => {
        return { sessions: taskStore.getMasterSessions() };
    });
}
