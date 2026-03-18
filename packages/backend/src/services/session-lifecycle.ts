import { MSG } from "@taskflow/shared";
import type { SessionRef, WsEvent } from "@taskflow/shared";
import type { PtyManager } from "./pty-manager";
import type { TaskStore } from "./task-store";
import { buildAgentLaunchSpec, ensureInternalAgentSkillFile } from "./internal-agent-skill";
import { ensureCursorRulesFile } from "./cursor-rules";
import { config } from "../config";
import { filterTaskSessions, filterProjectSessions } from "./instance-filter";

interface SessionOwner {
    taskId?: string;
    projectId?: string;
}

interface CreateSessionOpts {
    owner: SessionOwner;
    type: "claude" | "codex" | "cursor" | "shell";
    label?: string;
    prompt?: string;
    systemPrompt?: string;
    shell?: string;
    agentOptions?: import("@taskflow/shared").AgentLaunchOptions;
    flow?: {
        flowId: string;
        actionEntryId: string;
    };
    cols?: number;
    rows?: number;
    onSessionExited?: (sessionId: string, exitCode: number) => void;
}

interface SessionLifecycleDeps {
    ptyManager: PtyManager;
    taskStore: TaskStore;
    broadcast: (event: WsEvent) => void;
    getPort: () => number;
}

function getDefaultSessionLabel(type: CreateSessionOpts["type"]): string {
    if (type === "claude") return "Claude";
    if (type === "codex") return "Codex";
    if (type === "cursor") return "Cursor";
    return `${type} session`;
}

function createSessionLifecycle(deps: SessionLifecycleDeps) {
    const { ptyManager, taskStore, broadcast, getPort } = deps;

    async function removeSessionFromOwner(sessionId: string, owner?: SessionOwner): Promise<void> {
        const targetTask = owner?.taskId ? await taskStore.getTask(owner.taskId) : null;
        if (targetTask?.sessions.some((session) => session.id === sessionId)) {
            await taskStore.updateTask(targetTask.id, (task) => ({
                sessions: task.sessions.filter((session) => session.id !== sessionId),
            }));
            await taskStore.deleteSessionHistory(targetTask.id, sessionId);
            return;
        }

        const targetProject = owner?.projectId ? await taskStore.getProject(owner.projectId) : null;
        if (targetProject?.sessions.some((session) => session.id === sessionId)) {
            await taskStore.updateProject(targetProject.id, (project) => ({
                sessions: project.sessions.filter((session) => session.id !== sessionId),
            }));
            await taskStore.deleteSessionHistory(targetProject.id, sessionId);
            return;
        }

        const activeOwner = (owner?.taskId ? [] : await taskStore.listTasks()).find((task) =>
            task.sessions.some((session) => session.id === sessionId),
        );
        if (activeOwner) {
            await taskStore.updateTask(activeOwner.id, (task) => ({
                sessions: task.sessions.filter((session) => session.id !== sessionId),
            }));
            await taskStore.deleteSessionHistory(activeOwner.id, sessionId);
            return;
        }

        const activeProjectOwner = (owner?.projectId ? [] : await taskStore.listProjects()).find(
            (project) => project.sessions.some((session) => session.id === sessionId),
        );
        if (activeProjectOwner) {
            await taskStore.updateProject(activeProjectOwner.id, (project) => ({
                sessions: project.sessions.filter((session) => session.id !== sessionId),
            }));
            await taskStore.deleteSessionHistory(activeProjectOwner.id, sessionId);
            return;
        }

        const archivedOwner = (await taskStore.listArchived()).find((task) =>
            task.sessions.some((session) => session.id === sessionId),
        );
        if (!archivedOwner) return;

        await taskStore.updateArchived(archivedOwner.id, (task) => ({
            sessions: task.sessions.filter((session) => session.id !== sessionId),
        }));
        await taskStore.deleteSessionHistory(archivedOwner.id, sessionId);
    }

    async function createSession(opts: CreateSessionOpts): Promise<string> {
        const {
            owner,
            type,
            prompt,
            systemPrompt,
            shell,
            agentOptions,
            flow,
            cols,
            rows,
            onSessionExited,
        } = opts;
        const { taskId, projectId } = owner;

        if ((taskId ? 1 : 0) + (projectId ? 1 : 0) !== 1) {
            throw new Error("Exactly one of taskId or projectId is required");
        }

        const task = taskId ? await taskStore.getTask(taskId) : null;
        if (taskId && !task) throw new Error(`Task not found: ${taskId}`);

        const project = task
            ? await taskStore.getProject(task.projectId)
            : projectId
              ? await taskStore.getProject(projectId)
              : null;
        if (!project) throw new Error(`Project not found: ${task?.projectId ?? projectId}`);

        const cwd =
            task?.worktree.enabled && task.worktree.path ? task.worktree.path : project.path;

        let command: string;
        const args: string[] = [];
        if (type === "shell") {
            if (!shell) throw new Error("shell path is required for shell sessions");
            command = shell;
        } else {
            const skillPath = await ensureInternalAgentSkillFile(config.agentSkillsDir);
            if (type === "cursor" && systemPrompt) {
                await ensureCursorRulesFile(cwd, systemPrompt);
            }
            const spec = buildAgentLaunchSpec(type, prompt, skillPath, agentOptions, systemPrompt, !task);
            command = spec.command;
            args.push(...spec.args);
        }

        const sessionId = crypto.randomUUID();
        const taskflowEnv: Record<string, string> = {
            TASKFLOW_API_URL: `http://localhost:${getPort()}`,
            TASKFLOW_SESSION_ID: sessionId,
        };
        if (task) taskflowEnv.TASKFLOW_TASK_ID = task.id;
        if (project) taskflowEnv.TASKFLOW_PROJECT_ID = project.id;
        if (flow) {
            taskflowEnv.TASKFLOW_FLOW_ID = flow.flowId;
            taskflowEnv.TASKFLOW_ACTION_ENTRY_ID = flow.actionEntryId;
        }

        ptyManager.spawn({
            id: sessionId,
            command,
            args,
            cwd,
            env: taskflowEnv,
            cols,
            rows,
            onData: (data, sequence) => {
                void taskStore.appendSessionOutput(
                    task?.id ?? project.id,
                    sessionId,
                    sequence,
                    data,
                );
                broadcast({
                    type: MSG.TERMINAL_OUTPUT,
                    payload: { sessionId, data, sequence },
                });
            },
            onExit: (exitCode) => {
                broadcast({
                    type: MSG.SESSION_EXITED,
                    payload: { sessionId, exitCode },
                });
                void removeSessionFromOwner(sessionId, {
                    taskId: task?.id,
                    projectId: project.id,
                });
                onSessionExited?.(sessionId, exitCode);
            },
        });

        const sessionRef: SessionRef = {
            id: sessionId,
            type,
            label: opts.label ?? getDefaultSessionLabel(type),
            createdAt: new Date().toISOString(),
            instance: config.instanceId,
        };
        if (task) {
            await taskStore.updateTask(task.id, (currentTask) => ({
                sessions: [...currentTask.sessions, sessionRef],
            }));
            const updatedTask = await taskStore.getTask(task.id);
            if (updatedTask) {
                broadcast({ type: MSG.TASK_UPDATED, payload: filterTaskSessions(updatedTask, config.instanceId) });
            }
        } else {
            await taskStore.updateProject(project.id, (currentProject) => ({
                sessions: [...currentProject.sessions, sessionRef],
            }));
            const updatedProject = await taskStore.getProject(project.id);
            if (updatedProject) {
                broadcast({ type: MSG.PROJECT_UPDATED, payload: filterProjectSessions(updatedProject, config.instanceId) });
            }
        }

        if (type !== "shell") {
            broadcast({
                type: MSG.SESSION_STATUS,
                payload: { sessionId, status: "initializing" },
            });
        }

        return sessionId;
    }

    return { createSession, removeSessionFromOwner };
}

export { createSessionLifecycle };
export type { CreateSessionOpts, SessionOwner, SessionLifecycleDeps };
