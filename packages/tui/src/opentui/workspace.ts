import type { CliRenderer } from "@opentui/core";
import type {
    ActionDefinition,
    FlowDefinition,
    Schedule,
    ScheduleCreatePayload,
    ScheduleUpdatePayload,
    Task,
} from "@taskflow/shared";
import type { NetLike } from "../net/client";
import { Store } from "../state/store";
import { SessionController } from "../sessions/controller";
import { ownerRequest, type SessionOwner } from "../sessions/owner";
import { ActionRunner } from "../sessions/action-runner";
import { FlowStore } from "../flows/store";
import { ownerProjectId, visibleDefinitions } from "../flows/model";
import { ScheduleStore } from "../schedules/store";
import { TaskDetailStore } from "../tasks/store";
import { GitStore } from "../git/store";
import { SettingsStore } from "../settings/store";
import { NotificationStore } from "../notifications/store";
import { deliverNativeNotification } from "../notifications/deliver";
import {
    actionRecord,
    flowRecord,
    newScheduleDraft,
    parseActionDraft,
    parseFlowDraft,
    parseScheduleDraft,
    schedulePayload,
    serializeAction,
    serializeFlow,
    serializeSchedule,
} from "../editor/records";
import { defaultExternalEditorDeps, editRecord } from "../editor/external-editor";
import { OpenTuiApp, type KeyOverlay, type MachineStatus, type OverlayHandle } from "./app";
import { SessionBridge } from "./session-bridge";

interface WorkspaceContext {
    renderer: CliRenderer;
    machineId: string;
    machineLabel: string;
    local: boolean;
    onQuit(): void;
    /** Absent when there is nothing to switch to, e.g. a hand-opened `--connect` tunnel. */
    onSwitchMachine?: () => void;
}

type WorkspaceSelection = { projectId: string | null; taskId: string | null };

interface Workspace {
    readonly app: OpenTuiApp;
    readonly local: boolean;
    readonly machineId: string;
    hasOpenEditor(): boolean;
    selection(): WorkspaceSelection;
    restoreSelection(selection: WorkspaceSelection): void;
    showOverlay(overlay: KeyOverlay): OverlayHandle;
    setMachineStatus(status: MachineStatus): void;
    /** Resend every session's terminal size, e.g. after the machine came back. */
    resetSessionResizes(): void;
    dispose(): void;
}

function editorActions(
    kind: "flow" | "action" | "schedule",
    actions: readonly ActionDefinition[],
    owner: SessionOwner,
): ActionDefinition[] {
    return kind === "schedule" ? [...actions] : visibleDefinitions(actions, owner);
}

async function openWorkspace(net: NetLike, context: WorkspaceContext): Promise<Workspace> {
    const { renderer } = context;
    let app: OpenTuiApp | null = null;
    let openEditors = 0;
    let disposed = false;

    const store = new Store(net);
    const flowStore = new FlowStore(net);
    const scheduleStore = new ScheduleStore(net);
    const taskDetailStore = new TaskDetailStore(net);
    const gitStore = new GitStore(net);
    const settingsStore = new SettingsStore(net);
    const notificationStore = new NotificationStore(net, (notification) =>
        deliverNativeNotification(notification),
    );
    const controller = new SessionController({
        createBridge: (session, sessionOwner) => {
            const pane = app?.paneDimensions ?? {
                cols: Math.max(
                    1,
                    renderer.terminalWidth - Math.min(30, Math.floor(renderer.terminalWidth / 3)),
                ),
                rows: Math.max(1, renderer.terminalHeight - 1),
            };
            return new SessionBridge({
                renderer,
                net,
                sessionId: session.id,
                owner: ownerRequest(sessionOwner),
                cols: pane.cols,
                rows: pane.rows,
            });
        },
        request: <T>(type: string, payload?: unknown) => net.request<T>(type, payload),
        onChange: (sessions, activeId) => app?.setSessions(sessions, activeId),
    });
    const actionRunner = new ActionRunner(net, controller);

    const dispose = (): void => {
        if (disposed) return;
        disposed = true;
        app?.destroy();
        controller.destroy();
        store.dispose();
        flowStore.dispose();
        scheduleStore.dispose();
        taskDetailStore.dispose();
        gitStore.dispose();
        settingsStore.dispose();
        notificationStore.dispose();
    };

    const trackEditor = async <T>(edit: () => Promise<T>): Promise<T> => {
        openEditors++;
        try {
            return await edit();
        } finally {
            openEditors--;
        }
    };

    const externalEditorDeps = () => {
        const editor = settingsStore.terminalEditor();
        if (!editor) {
            throw new Error(
                "No terminal editor found. Install Neovim, Nano, Vim, Vi, or another terminal editor.",
            );
        }
        const deps = defaultExternalEditorDeps(
            renderer,
            () => app?.blurForEditor(),
            () => app?.restoreAfterEditor(),
        );
        deps.editor = editor.command;
        return deps;
    };

    const editTaskText = (task: Task, field: "description" | "notes"): Promise<Task | null> =>
        trackEditor(async () => {
            let updated: Task | null = null;
            const result = await editRecord({
                filename: `${field}.txt`,
                initialContents: task[field],
                validate: (source) => source,
                save: async (source) => {
                    updated = await taskDetailStore.update({ id: task.id, [field]: source });
                },
                deps: externalEditorDeps(),
            });
            return result === null ? null : updated;
        });

    const editProductRecord = (
        kind: "flow" | "action" | "schedule",
        record: FlowDefinition | ActionDefinition | Schedule | null,
        sessionOwner: SessionOwner,
    ): Promise<void> =>
        trackEditor(async () => {
            const projectId = ownerProjectId(sessionOwner);
            const visibleActions = editorActions(kind, flowStore.actions, sessionOwner);
            const editorContext = {
                projectId,
                projectIds: store.projects.map((project) => project.id),
                visibleActions,
            };
            const deps = externalEditorDeps();

            if (kind === "action") {
                const existing = record as ActionDefinition | null;
                const initial =
                    existing ??
                    ({
                        projectId: projectId ?? undefined,
                        name: "New action",
                        prompt: "Describe the action",
                        sessionType: "shell",
                        standalone: false,
                    } as const);
                await editRecord({
                    filename: "action.yaml",
                    initialContents: serializeAction(initial),
                    validate: (source) =>
                        actionRecord(
                            parseActionDraft(source, editorContext),
                            existing ?? undefined,
                        ),
                    save: (value) => flowStore.saveAction(value),
                    deps,
                });
                return;
            }

            if (kind === "flow") {
                const existing = record as FlowDefinition | null;
                const firstAction = visibleActions[0];
                const initial =
                    existing ??
                    ({
                        projectId: projectId ?? undefined,
                        name: "New flow",
                        description: "",
                        actions: firstAction
                            ? [{ id: "step-1", actionId: firstAction.id }]
                            : [
                                  {
                                      id: "step-1",
                                      inline: {
                                          name: "First step",
                                          prompt: "Describe the step",
                                          sessionType: "shell" as const,
                                      },
                                  },
                              ],
                    } as const);
                await editRecord({
                    filename: "flow.yaml",
                    initialContents: serializeFlow(initial, visibleActions),
                    validate: (source) =>
                        flowRecord(parseFlowDraft(source, editorContext), existing ?? undefined),
                    save: (value) => flowStore.saveFlow(value),
                    deps,
                });
                return;
            }

            const existing = record as Schedule | null;
            const createProjectId = projectId ?? store.projects[0]?.id;
            if (!existing && !createProjectId)
                throw new Error("Create a project before adding a schedule");
            const initial = existing ?? newScheduleDraft(createProjectId);
            const scheduleContext = {
                ...editorContext,
                projectId: existing?.projectId ?? projectId,
            };
            await editRecord({
                filename: "schedule.yaml",
                initialContents: serializeSchedule(initial, !existing),
                validate: (source) => parseScheduleDraft(source, scheduleContext, !existing),
                save: async (draft) => {
                    const payload = schedulePayload(draft, existing ?? undefined);
                    if (existing) await scheduleStore.update(payload as ScheduleUpdatePayload);
                    else await scheduleStore.create(payload as ScheduleCreatePayload);
                },
                deps,
            });
        });

    try {
        const createdApp = new OpenTuiApp({
            renderer,
            local: context.local,
            net,
            store,
            flowStore,
            scheduleStore,
            taskStore: taskDetailStore,
            gitStore,
            settingsStore,
            notificationStore,
            onOwnerChange: (sessionOwner, sessions) => controller.reconcile(sessionOwner, sessions),
            onSessionSelect: (sessionId) => controller.select(sessionId),
            onReconnect: () => controller.reattach(),
            onCreate: (sessionOwner, payload) => controller.create(sessionOwner, payload),
            onClose: (sessionId) => controller.close(sessionId),
            onResume: (sessionId, cols, rows) => controller.resume(sessionId, cols, rows),
            onRunAction: (sessionOwner, action) => actionRunner.run(sessionOwner, action),
            onEditRecord: editProductRecord,
            onEditTaskText: editTaskText,
            onFocusSession: (sessionId) => controller.focusKnown(sessionId),
            onQuit: () => context.onQuit(),
            machineLabel: context.machineLabel,
            onSwitchMachine: context.onSwitchMachine,
        });
        app = createdApp;
        await createdApp.init();
        renderer.requestRender();

        return {
            app: createdApp,
            local: context.local,
            machineId: context.machineId,
            hasOpenEditor: () => openEditors > 0,
            selection: () => {
                const owner = createdApp.selectedOwner;
                if (owner.kind === "task")
                    return { projectId: owner.projectId, taskId: owner.taskId };
                if (owner.kind === "project") return { projectId: owner.projectId, taskId: null };
                return { projectId: null, taskId: null };
            },
            restoreSelection: (selection) => {
                const task = selection.taskId ? store.taskById(selection.taskId) : null;
                if (task) {
                    createdApp.selectOwner({
                        kind: "task",
                        taskId: task.id,
                        projectId: task.projectId,
                    });
                    return;
                }
                if (selection.projectId && store.projectById(selection.projectId)) {
                    createdApp.selectOwner({ kind: "project", projectId: selection.projectId });
                }
            },
            showOverlay: (overlay) => createdApp.showOverlay(overlay),
            setMachineStatus: (status) => createdApp.setMachineStatus(status),
            resetSessionResizes: () => controller.resetResizes(),
            dispose,
        };
    } catch (error) {
        dispose();
        throw error;
    }
}

export { editorActions, openWorkspace };
export type { Workspace, WorkspaceContext };
