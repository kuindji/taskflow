import { MSG, isAgentType } from "@taskflow/shared";
import type {
    AgentLaunchOptions,
    AgentType,
    AppSettings,
    SessionRef,
    WsEvent,
} from "@taskflow/shared";
import type { PtyManager } from "./pty-manager";
import type { TaskStore } from "./task-store";
import type { SettingsStore } from "./settings-store";
import {
    buildAgentLaunchSpec,
    buildProjectContextBlock,
    buildSystemPrompt,
    ensureInternalAgentSkillFile,
    PROMPT_AUTONOMOUS,
} from "./internal-agent-skill";
import { getEditorById } from "./editor-detector";
import type { TrayStateTracker } from "./tray-state-tracker";
import { homedir } from "os";
import { join } from "path";
import { mkdirSync } from "fs";
import { config } from "../config";
import { filterTaskSessions, filterProjectSessions } from "./instance-filter";
import { normalizeClaudeLaunchOptions } from "./claude-options";

interface SessionOwner {
    taskId?: string;
    projectId?: string;
    master?: boolean;
}

interface CreateSessionOpts {
    owner: SessionOwner;
    type: "claude" | "codex" | "opencode" | "pi" | "kimi" | "shell" | "editor";
    label?: string;
    prompt?: string;
    systemPrompt?: string;
    shell?: string;
    cwd?: string;
    editorId?: string;
    filePath?: string;
    line?: number;
    agentOptions?: import("@taskflow/shared").AgentLaunchOptions;
    flow?: {
        flowId: string;
        actionEntryId: string;
    };
    cols?: number;
    rows?: number;
    onSessionExited?: (sessionId: string, exitCode: number) => void;
    /** Called on every PTY data event for this session. */
    onSessionData?: (sessionId: string) => void;
    /** When true, the session is not registered as a tab in the UI. */
    internal?: boolean;
    /** Display name passed to the agent CLI (e.g. Claude's --name flag). */
    sessionName?: string;
    /** Start an interactive Claude session with native Remote Control enabled. */
    remoteControl?: boolean;
    /** When true, the session does not contribute to the system tray status dot. */
    trayExclude?: boolean;
}

function isAutonomousAgent(
    opts: import("@taskflow/shared").AgentLaunchOptions | undefined,
    type: string,
): boolean {
    if (!opts || type === "claude") return false;
    if (opts.type === "codex")
        return !!opts.dangerouslyBypassApprovalsAndSandbox || opts.approvalPolicy === "never";
    if (opts.type === "kimi")
        return opts.permissionMode === "auto" || opts.permissionMode === "yolo";
    return "dontAskQuestions" in opts && !!opts.dontAskQuestions;
}

interface SessionLifecycleDeps {
    ptyManager: PtyManager;
    taskStore: TaskStore;
    settingsStore: SettingsStore;
    broadcast: (event: WsEvent, opts?: { dropOnBackpressure?: boolean }) => void;
    getPort: () => number;
    detectedEditors: import("@taskflow/shared").EditorInfo[];
    trayStateTracker: TrayStateTracker;
}

function settingsToAgentOptions(type: AgentType, settings: AppSettings): AgentLaunchOptions {
    switch (type) {
        case "claude": {
            const s = settings.claude;
            return {
                type: "claude",
                permissionMode: s.permissionMode === "default" ? undefined : s.permissionMode,
                model: s.defaultModel === "default" ? undefined : s.defaultModel || undefined,
                effort: s.defaultEffort === "default" ? undefined : s.defaultEffort,
            };
        }
        case "codex": {
            const s = settings.codex;
            return {
                type: "codex",
                model: s.defaultModel === "default" ? undefined : s.defaultModel || undefined,
                reasoningEffort:
                    s.defaultReasoningEffort === "default" ? undefined : s.defaultReasoningEffort,
                sandbox: s.sandbox,
                approvalPolicy: s.approvalPolicy,
                dangerouslyBypassApprovalsAndSandbox:
                    s.dangerouslyBypassApprovalsAndSandbox || undefined,
            };
        }
        case "opencode": {
            const s = settings.opencode;
            return {
                type: "opencode",
                model: s.defaultModel || undefined,
                autoApprove: s.autoApprove || undefined,
            };
        }
        case "pi": {
            const s = settings.pi;
            return {
                type: "pi",
                model: s.defaultModel || undefined,
                thinking: s.thinking === "off" ? undefined : s.thinking,
                tools: s.tools || undefined,
            };
        }
        case "kimi": {
            const s = settings.kimi;
            return {
                type: "kimi",
                model: s.defaultModel || undefined,
                permissionMode: s.permissionMode === "manual" ? undefined : s.permissionMode,
            };
        }
    }
}

function mergeAgentOptions(
    defaults: AgentLaunchOptions,
    explicit: AgentLaunchOptions | undefined,
): AgentLaunchOptions {
    switch (defaults.type) {
        case "claude":
            return explicit?.type === "claude" ? { ...defaults, ...explicit } : defaults;
        case "codex":
            return explicit?.type === "codex" ? { ...defaults, ...explicit } : defaults;
        case "opencode":
            return explicit?.type === "opencode" ? { ...defaults, ...explicit } : defaults;
        case "pi":
            return explicit?.type === "pi" ? { ...defaults, ...explicit } : defaults;
        case "kimi":
            return explicit?.type === "kimi" ? { ...defaults, ...explicit } : defaults;
    }
}

function getDefaultSessionLabel(type: CreateSessionOpts["type"]): string {
    if (type === "claude") return "Claude";
    if (type === "codex") return "Codex";
    if (type === "opencode") return "OpenCode";
    if (type === "pi") return "Pi";
    if (type === "kimi") return "Kimi";
    if (type === "editor") return "Editor";
    return `${type} session`;
}

function createSessionLifecycle(deps: SessionLifecycleDeps) {
    const {
        ptyManager,
        taskStore,
        settingsStore,
        broadcast,
        getPort,
        detectedEditors,
        trayStateTracker,
    } = deps;

    async function broadcastTaskUpdate(taskId: string): Promise<void> {
        const updated = await taskStore.getTask(taskId);
        if (updated) {
            broadcast({
                type: MSG.TASK_UPDATED,
                payload: filterTaskSessions(updated, config.instanceId),
            });
        }
    }

    async function broadcastProjectUpdate(projectId: string): Promise<void> {
        const updated = await taskStore.getProject(projectId);
        if (updated) {
            broadcast({
                type: MSG.PROJECT_UPDATED,
                payload: filterProjectSessions(updated, config.instanceId),
            });
        }
    }

    async function removeSessionFromOwner(sessionId: string, owner?: SessionOwner): Promise<void> {
        const targetTask = owner?.taskId ? await taskStore.getTask(owner.taskId) : null;
        if (targetTask?.sessions.some((session) => session.id === sessionId)) {
            await taskStore.updateTask(targetTask.id, (task) => ({
                sessions: task.sessions.filter((session) => session.id !== sessionId),
            }));
            await taskStore.deleteSessionHistory(targetTask.id, sessionId);
            await broadcastTaskUpdate(targetTask.id);
            return;
        }

        const targetProject = owner?.projectId ? await taskStore.getProject(owner.projectId) : null;
        if (targetProject?.sessions.some((session) => session.id === sessionId)) {
            await taskStore.updateProject(targetProject.id, (project) => ({
                sessions: project.sessions.filter((session) => session.id !== sessionId),
            }));
            await taskStore.deleteSessionHistory(targetProject.id, sessionId);
            await broadcastProjectUpdate(targetProject.id);
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
            await broadcastTaskUpdate(activeOwner.id);
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
            await broadcastProjectUpdate(activeProjectOwner.id);
            return;
        }

        const archivedOwner = (await taskStore.listArchived()).find((task) =>
            task.sessions.some((session) => session.id === sessionId),
        );
        if (archivedOwner) {
            await taskStore.updateArchived(archivedOwner.id, (task) => ({
                sessions: task.sessions.filter((session) => session.id !== sessionId),
            }));
            await taskStore.deleteSessionHistory(archivedOwner.id, sessionId);
            return;
        }

        // Check master sessions
        const masterSessions = taskStore.getMasterSessions();
        if (masterSessions.some((s) => s.id === sessionId)) {
            taskStore.removeMasterSession(sessionId);
            await taskStore.deleteSessionHistory("master", sessionId);
            broadcast({
                type: MSG.MASTER_SESSIONS_LIST,
                payload: { sessions: taskStore.getMasterSessions() },
            });
        }
    }

    async function createSession(opts: CreateSessionOpts): Promise<string> {
        const {
            owner,
            type,
            prompt,
            systemPrompt,
            shell,
            cwd: cwdOverride,
            editorId,
            filePath,
            line,
            agentOptions,
            flow,
            cols,
            rows,
            onSessionExited,
        } = opts;
        const { taskId, projectId, master } = owner;

        if ((taskId ? 1 : 0) + (projectId ? 1 : 0) + (master ? 1 : 0) !== 1) {
            throw new Error("Exactly one of taskId, projectId, or master is required");
        }

        let task: Awaited<ReturnType<typeof taskStore.getTask>> | null = null;
        let project: Awaited<ReturnType<typeof taskStore.getProject>> | null = null;
        let cwd: string;
        let resolvedProjectId = "";

        if (master) {
            cwd = cwdOverride ?? join(homedir(), ".config", "taskflow");
            mkdirSync(cwd, { recursive: true });
        } else {
            task = taskId ? await taskStore.getTask(taskId) : null;
            if (taskId && !task) throw new Error(`Task not found: ${taskId}`);

            project = task
                ? await taskStore.getProject(task.projectId)
                : projectId
                  ? await taskStore.getProject(projectId)
                  : null;
            if (!project) throw new Error(`Project not found: ${task?.projectId ?? projectId}`);

            resolvedProjectId = project.id;
            cwd =
                cwdOverride ??
                (task?.worktree.enabled && task.worktree.path ? task.worktree.path : project.path);
        }

        let command: string;
        const args: string[] = [];
        let specEnv: Record<string, string> | undefined;
        let specInitialInput: string | undefined;
        let shellSystemPrompt: string | undefined;
        if (type === "editor") {
            if (!editorId || !filePath) {
                throw new Error("editorId and filePath are required for editor sessions");
            }
            const editor = getEditorById(detectedEditors, editorId);
            if (!editor) throw new Error(`Editor not found: ${editorId}`);

            command = editor.command;
            if (editor.extraArgs) args.push(...editor.extraArgs);

            if (line && editor.lineFlag) {
                const resolvedFlag = editor.lineFlag
                    .replace("{line}", String(line))
                    .replace("{file}", filePath);

                if (editor.lineFlag.includes("{file}")) {
                    args.push(resolvedFlag);
                } else {
                    args.push(resolvedFlag, filePath);
                }
            } else {
                args.push(filePath);
            }
        } else {
            // Build effective system prompt for both shell and agent sessions
            let effectiveSystemPrompt = systemPrompt;
            let resolvedAgentOptions =
                type === "claude" ? normalizeClaudeLaunchOptions(agentOptions) : agentOptions;
            if (type !== "shell") {
                // Persisted stores may still reference removed agent types; the
                // compile-time union cannot protect against casts from JSON.
                if (!isAgentType(type)) {
                    throw new Error(`Unsupported agent type: ${String(type)}`);
                }
                // Merge user-configured defaults under any explicit per-run options.
                const settings = await settingsStore.get();
                const defaultAgentOptions = settingsToAgentOptions(type, settings);
                resolvedAgentOptions = mergeAgentOptions(
                    defaultAgentOptions,
                    resolvedAgentOptions?.type === type ? resolvedAgentOptions : undefined,
                );
                if (isAutonomousAgent(resolvedAgentOptions, type)) {
                    effectiveSystemPrompt = effectiveSystemPrompt
                        ? `${effectiveSystemPrompt}\n\n${PROMPT_AUTONOMOUS}`
                        : PROMPT_AUTONOMOUS;
                }
            }
            if (project && (project.prompt || project.linkedProjects?.length)) {
                const resolvedProjects: Record<string, { name: string; path: string }> = {};
                for (const link of project.linkedProjects ?? []) {
                    const linked = await taskStore.getProject(link.projectId);
                    if (linked) {
                        resolvedProjects[link.projectId] = {
                            name: linked.name,
                            path: linked.path,
                        };
                    }
                }
                const projectBlock = buildProjectContextBlock({
                    prompt: project.prompt,
                    linkedProjects: project.linkedProjects,
                    resolvedProjects,
                });
                if (projectBlock) {
                    effectiveSystemPrompt = effectiveSystemPrompt
                        ? `${effectiveSystemPrompt}\n\n${projectBlock}`
                        : projectBlock;
                }
            }

            if (type === "shell") {
                if (!shell) throw new Error("shell path is required for shell sessions");
                command = shell;
                // Assemble full system prompt and expose via env var
                const basePrompt = buildSystemPrompt(!task, !!flow);
                shellSystemPrompt = effectiveSystemPrompt
                    ? `${basePrompt}\n\n${effectiveSystemPrompt}`
                    : basePrompt;
            } else {
                const skillPath = await ensureInternalAgentSkillFile(config.agentSkillsDir);
                const spec = buildAgentLaunchSpec(
                    type,
                    prompt,
                    skillPath,
                    resolvedAgentOptions,
                    effectiveSystemPrompt,
                    !task,
                    !!flow,
                );
                command = spec.command;
                if (opts.sessionName && type === "claude") {
                    args.push("--name", opts.sessionName);
                }
                if (opts.remoteControl && type === "claude") {
                    args.push("--remote-control");
                }
                args.push(...spec.args);
                specEnv = spec.env;
                specInitialInput = spec.initialInput;
            }
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
        if (shellSystemPrompt) {
            taskflowEnv.TASKFLOW_SYSTEM_PROMPT = shellSystemPrompt;
        }

        if (!opts.internal && !opts.trayExclude) {
            trayStateTracker.registerSession(sessionId, type);
        }

        const ownerId = master ? "master" : (task?.id ?? resolvedProjectId);

        let appendErrorLogged = false;

        ptyManager.spawn({
            id: sessionId,
            command,
            args,
            cwd,
            env: specEnv ? { ...taskflowEnv, ...specEnv } : taskflowEnv,
            initialInput: specInitialInput,
            cols,
            rows,
            onData: (data, sequence) => {
                void taskStore
                    .appendSessionOutput(ownerId, sessionId, sequence, data)
                    .catch((err: unknown) => {
                        if (!appendErrorLogged) {
                            appendErrorLogged = true;
                            console.error(
                                `[session] Failed to persist output for session ${sessionId}:`,
                                err,
                            );
                        }
                    });
                trayStateTracker.markSessionActivity(sessionId);
                opts.onSessionData?.(sessionId);
                broadcast(
                    {
                        type: MSG.TERMINAL_OUTPUT,
                        payload: { sessionId, data, sequence },
                    },
                    { dropOnBackpressure: true },
                );
            },
            onExit: (exitCode) => {
                if (!opts.internal) {
                    trayStateTracker.clearSession(sessionId);
                    broadcast({
                        type: MSG.SESSION_EXITED,
                        payload: { sessionId, exitCode },
                    });
                    void removeSessionFromOwner(
                        sessionId,
                        master
                            ? { master: true }
                            : {
                                  taskId: task?.id,
                                  projectId: resolvedProjectId,
                              },
                    ).catch((err: unknown) => {
                        console.error(
                            `[session] Failed to remove session ${sessionId} from owner:`,
                            err,
                        );
                    });
                }
                onSessionExited?.(sessionId, exitCode);
            },
        });

        if (!opts.internal) {
            const sessionRef: SessionRef = {
                id: sessionId,
                type,
                label: opts.label ?? getDefaultSessionLabel(type),
                createdAt: new Date().toISOString(),
                instance: config.instanceId,
                ...(opts.trayExclude && { trayExclude: true }),
            };
            if (master) {
                taskStore.addMasterSession(sessionRef);
                broadcast({
                    type: MSG.MASTER_SESSIONS_LIST,
                    payload: { sessions: taskStore.getMasterSessions() },
                });
            } else if (task) {
                await taskStore.updateTask(task.id, (currentTask) => ({
                    sessions: [...currentTask.sessions, sessionRef],
                }));
                const updatedTask = await taskStore.getTask(task.id);
                if (updatedTask) {
                    broadcast({
                        type: MSG.TASK_UPDATED,
                        payload: filterTaskSessions(updatedTask, config.instanceId),
                    });
                }
            } else {
                await taskStore.updateProject(resolvedProjectId, (currentProject) => ({
                    sessions: [...currentProject.sessions, sessionRef],
                }));
                const updatedProject = await taskStore.getProject(resolvedProjectId);
                if (updatedProject) {
                    broadcast({
                        type: MSG.PROJECT_UPDATED,
                        payload: filterProjectSessions(updatedProject, config.instanceId),
                    });
                }
            }

            if (type !== "shell" && type !== "editor") {
                broadcast({
                    type: MSG.SESSION_STATUS,
                    payload: { sessionId, status: "initializing" },
                });
            }
        }

        return sessionId;
    }

    return { createSession, removeSessionFromOwner };
}

export { createSessionLifecycle };
export type { CreateSessionOpts, SessionOwner, SessionLifecycleDeps };
