import { MSG } from "@taskflow/shared";
import type {
    SessionCreatePayload,
    SessionClosePayload,
    SessionRenamePayload,
    SessionInputPayload,
    SessionHistoryPayload,
    TerminalResizePayload,
    SessionRef,
    CursorRulesCheckPayload,
    CursorRulesEnsurePayload,
} from "@taskflow/shared";
import type { Router } from "../ws/router";
import type { PtyManager } from "../services/pty-manager";
import type { TaskStore } from "../services/task-store";
import type { createSessionLifecycle } from "../services/session-lifecycle";
import { checkCursorRulesStatus, ensureCursorRulesFile } from "../services/cursor-rules";

interface SessionHandlerDeps {
    router: Router;
    ptyManager: PtyManager;
    taskStore: TaskStore;
    sessionLifecycle: ReturnType<typeof createSessionLifecycle>;
}

export function registerSessionHandlers(deps: SessionHandlerDeps): void {
    const { router, ptyManager, taskStore, sessionLifecycle } = deps;

    router.register(MSG.SESSION_CREATE, async (payload) => {
        const { taskId, projectId, type, label, prompt, shell, cols, rows, agentOptions } =
            payload as SessionCreatePayload;
        const sessionId = await sessionLifecycle.createSession({
            owner: { taskId, projectId },
            type,
            label,
            prompt,
            shell,
            agentOptions,
            cols,
            rows,
        });
        return { sessionId };
    });

    router.register(MSG.SESSION_INPUT, async (payload) => {
        const { sessionId, data } = payload as SessionInputPayload;
        ptyManager.write(sessionId, data);
        return { success: true };
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

        throw new Error(`Session not found: ${sessionId}`);
    });

    router.register(MSG.TERMINAL_RESIZE, async (payload) => {
        const { sessionId, cols, rows } = payload as TerminalResizePayload;
        ptyManager.resize(sessionId, cols, rows);
        return { success: true };
    });

    router.register(MSG.SESSION_HISTORY, async (payload) => {
        const { taskId, projectId, sessionId } = payload as SessionHistoryPayload;
        const ownerId = taskId ?? projectId;
        if (!ownerId || (taskId && projectId)) {
            throw new Error("Exactly one of taskId or projectId is required");
        }
        return taskStore.getSessionHistory(ownerId, sessionId);
    });

    router.register(MSG.CURSOR_RULES_CHECK, async (payload) => {
        const { cwd } = payload as CursorRulesCheckPayload;
        const status = await checkCursorRulesStatus(cwd);
        return { status };
    });

    router.register(MSG.CURSOR_RULES_ENSURE, async (payload) => {
        const { cwd } = payload as CursorRulesEnsurePayload;
        await ensureCursorRulesFile(cwd);
        return { ok: true };
    });
}
