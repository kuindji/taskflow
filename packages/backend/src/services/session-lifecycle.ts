import { MSG, isAgentType, backendHttpOrigin } from "@taskflow/shared";
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
import { mkdirSync } from "fs";
import { config } from "../config";
import { filterTaskSessions, filterProjectSessions } from "./instance-filter";
import { normalizeClaudeLaunchOptions } from "./claude-options";
import {
    acquireNativeSessionLaunchLock,
    captureNativeSessionIds,
    discoverNativeSessionId,
} from "./native-session-discovery";

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
    /** Existing durable session record being attached to a new PTY. */
    resumeSession?: SessionRef;
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
    nativeSessionDiscovery?: {
        acquire: typeof acquireNativeSessionLaunchLock;
        capture: typeof captureNativeSessionIds;
        discover: typeof discoverNativeSessionId;
    };
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
    const nativeSessionDiscovery = deps.nativeSessionDiscovery ?? {
        acquire: acquireNativeSessionLaunchLock,
        capture: captureNativeSessionIds,
        discover: discoverNativeSessionId,
    };
    let preservingSessionsForShutdown = false;
    let recoveredSessionExitHandler:
        | ((session: SessionRef, owner: SessionOwner, exitCode: number) => void)
        | undefined;
    let recoveredSessionResumeHandler:
        | ((session: SessionRef, owner: SessionOwner) => Promise<(() => Promise<void>) | undefined>)
        | undefined;
    const resumingSessionIds = new Set<string>();

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
            await taskStore.removeMasterSession(sessionId);
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

        const sessionId = opts.resumeSession?.id ?? crypto.randomUUID();

        let task: Awaited<ReturnType<typeof taskStore.getTask>> | null = null;
        let project: Awaited<ReturnType<typeof taskStore.getProject>> | null = null;
        let cwd: string;
        let resolvedProjectId = "";

        if (master) {
            cwd = cwdOverride ?? config.baseDir;
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
        let effectiveAgentOptions: AgentLaunchOptions | undefined;
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
                effectiveAgentOptions = resolvedAgentOptions;
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
                    opts.resumeSession
                        ? { mode: "resume", id: opts.resumeSession.nativeSessionId }
                        : { mode: "new", ...(type === "claude" && { id: sessionId }) },
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

        const taskflowEnv: Record<string, string> = {
            // Not `localhost`: the backend may be bound to `::1`, which `localhost`
            // does not reach on a host that resolves the name to IPv4 only.
            TASKFLOW_API_URL: backendHttpOrigin(getPort()),
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
        const priorHistory = opts.resumeSession
            ? await taskStore.getSessionHistory(ownerId, sessionId)
            : { data: "", lastSequence: 0 };

        let appendErrorLogged = false;
        const needsNativeDiscovery = !opts.resumeSession && isAgentType(type) && type !== "claude";
        const releaseNativeLaunchLock = needsNativeDiscovery
            ? await nativeSessionDiscovery.acquire(type)
            : null;
        let nativeSessionBaseline = new Set<string>();
        try {
            if (needsNativeDiscovery) {
                nativeSessionBaseline = await nativeSessionDiscovery.capture(type, cwd);
            }
        } catch (error) {
            await releaseNativeLaunchLock?.();
            throw error;
        }
        const nativeDiscoveryStartedAt = Date.now();

        try {
            ptyManager.spawn({
                id: sessionId,
                command,
                args,
                cwd,
                env: specEnv ? { ...taskflowEnv, ...specEnv } : taskflowEnv,
                initialInput: specInitialInput,
                ...(opts.resumeSession && {
                    initialOutput: priorHistory.data,
                    startSequence: priorHistory.lastSequence,
                }),
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
                    if (preservingSessionsForShutdown) return;
                    // The owner may already have dropped this session (archive
                    // clears the list before closing PTYs; internal sessions are
                    // never registered), so removeSessionFromOwner alone would
                    // leave the log behind. Delete it by the owner id we know.
                    const removal = opts.internal
                        ? Promise.resolve()
                        : removeSessionFromOwner(
                              sessionId,
                              master
                                  ? { master: true }
                                  : {
                                        taskId: task?.id,
                                        projectId: resolvedProjectId,
                                    },
                          );
                    void removal
                        .then(() => taskStore.deleteSessionHistory(ownerId, sessionId))
                        .catch((err: unknown) => {
                            console.error(
                                `[session] Failed to clean up exited session ${sessionId}:`,
                                err,
                            );
                        });
                    if (!opts.internal) {
                        trayStateTracker.clearSession(sessionId);
                        broadcast({
                            type: MSG.SESSION_EXITED,
                            payload: { sessionId, exitCode },
                        });
                    }
                    onSessionExited?.(sessionId, exitCode);
                },
            });
        } catch (error) {
            await releaseNativeLaunchLock?.();
            throw error;
        }

        if (!opts.internal) {
            const sessionRef: SessionRef = {
                id: sessionId,
                type,
                label: opts.label ?? opts.resumeSession?.label ?? getDefaultSessionLabel(type),
                createdAt: opts.resumeSession?.createdAt ?? new Date().toISOString(),
                instance: config.instanceId,
                bootId: config.bootId,
                state: "live",
                cwd,
                ...(effectiveAgentOptions && { agentOptions: effectiveAgentOptions }),
                ...(opts.resumeSession?.nativeSessionId
                    ? { nativeSessionId: opts.resumeSession.nativeSessionId }
                    : type === "claude"
                      ? { nativeSessionId: sessionId }
                      : {}),
                ...(flow && { flow }),
                ...(opts.trayExclude && { trayExclude: true }),
            };
            if (master) {
                if (opts.resumeSession) {
                    await taskStore.updateMasterSession(sessionId, sessionRef);
                } else {
                    await taskStore.addMasterSession(sessionRef);
                }
                broadcast({
                    type: MSG.MASTER_SESSIONS_LIST,
                    payload: { sessions: taskStore.getMasterSessions() },
                });
            } else if (task) {
                await taskStore.updateTask(task.id, (currentTask) => ({
                    sessions: opts.resumeSession
                        ? currentTask.sessions.map((session) =>
                              session.id === sessionId ? sessionRef : session,
                          )
                        : [...currentTask.sessions, sessionRef],
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
                    sessions: opts.resumeSession
                        ? currentProject.sessions.map((session) =>
                              session.id === sessionId ? sessionRef : session,
                          )
                        : [...currentProject.sessions, sessionRef],
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

        if (needsNativeDiscovery && releaseNativeLaunchLock) {
            void nativeSessionDiscovery
                .discover(type, cwd, nativeSessionBaseline, nativeDiscoveryStartedAt)
                .then(async (nativeSessionId) => {
                    if (!nativeSessionId || !ptyManager.has(sessionId)) return;
                    if (master) {
                        await taskStore.updateMasterSession(sessionId, { nativeSessionId });
                        broadcast({
                            type: MSG.MASTER_SESSIONS_LIST,
                            payload: { sessions: taskStore.getMasterSessions() },
                        });
                        return;
                    }
                    if (task) {
                        await taskStore.updateTask(task.id, (currentTask) => ({
                            sessions: currentTask.sessions.map((session) =>
                                session.id === sessionId
                                    ? { ...session, nativeSessionId }
                                    : session,
                            ),
                        }));
                        await broadcastTaskUpdate(task.id);
                        return;
                    }
                    await taskStore.updateProject(resolvedProjectId, (currentProject) => ({
                        sessions: currentProject.sessions.map((session) =>
                            session.id === sessionId ? { ...session, nativeSessionId } : session,
                        ),
                    }));
                    await broadcastProjectUpdate(resolvedProjectId);
                })
                .catch((error: unknown) => {
                    console.error(
                        `[session] Failed to identify native ${type} session ${sessionId}:`,
                        error,
                    );
                })
                .finally(() => {
                    void releaseNativeLaunchLock();
                });
        }

        return sessionId;
    }

    async function findSession(
        sessionId: string,
    ): Promise<{ session: SessionRef; owner: SessionOwner } | null> {
        const task = (await taskStore.listTasks()).find((candidate) =>
            candidate.sessions.some((session) => session.id === sessionId),
        );
        if (task) {
            const session = task.sessions.find((candidate) => candidate.id === sessionId);
            if (!session) return null;
            return {
                session,
                owner: { taskId: task.id },
            };
        }
        const project = (await taskStore.listProjects()).find((candidate) =>
            candidate.sessions.some((session) => session.id === sessionId),
        );
        if (project) {
            const session = project.sessions.find((candidate) => candidate.id === sessionId);
            if (!session) return null;
            return {
                session,
                owner: { projectId: project.id },
            };
        }
        const master = taskStore.getMasterSessions().find((session) => session.id === sessionId);
        return master ? { session: master, owner: { master: true } } : null;
    }

    async function resumeSession(sessionId: string, cols?: number, rows?: number): Promise<string> {
        const found = await findSession(sessionId);
        if (!found) throw new Error(`Session not found: ${sessionId}`);
        const { session, owner } = found;
        if (!isAgentType(session.type)) throw new Error("Only agent sessions can be resumed");
        if (session.instance !== config.instanceId) {
            throw new Error("Session belongs to another Taskflow instance");
        }
        if (session.state !== "interrupted") throw new Error("Session is not interrupted");
        if (!session.nativeSessionId) {
            throw new Error("The agent session identifier was not captured before interruption");
        }
        if (!session.cwd) throw new Error("The session working directory is unavailable");
        if (resumingSessionIds.has(sessionId))
            throw new Error("Session resume is already in progress");

        resumingSessionIds.add(sessionId);
        let rollback: (() => Promise<void>) | undefined;
        try {
            rollback = await recoveredSessionResumeHandler?.(session, owner);
            return await createSession({
                owner,
                type: session.type,
                label: session.label,
                cwd: session.cwd,
                agentOptions: session.agentOptions,
                flow: session.flow,
                cols,
                rows,
                resumeSession: session,
                onSessionExited: (_id, exitCode) => {
                    recoveredSessionExitHandler?.(session, owner, exitCode);
                },
            });
        } catch (error) {
            await rollback?.();
            throw error;
        } finally {
            resumingSessionIds.delete(sessionId);
        }
    }

    async function prepareForShutdown(): Promise<void> {
        preservingSessionsForShutdown = true;
        await taskStore.markBootSessionsInterrupted(config.instanceId, config.bootId);
    }

    function setRecoveredSessionExitHandler(
        handler: (session: SessionRef, owner: SessionOwner, exitCode: number) => void,
    ): void {
        recoveredSessionExitHandler = handler;
    }

    function setRecoveredSessionResumeHandler(
        handler: (
            session: SessionRef,
            owner: SessionOwner,
        ) => Promise<(() => Promise<void>) | undefined>,
    ): void {
        recoveredSessionResumeHandler = handler;
    }

    return {
        createSession,
        removeSessionFromOwner,
        resumeSession,
        prepareForShutdown,
        setRecoveredSessionExitHandler,
        setRecoveredSessionResumeHandler,
    };
}

export { createSessionLifecycle };
export type { CreateSessionOpts, SessionOwner, SessionLifecycleDeps };
