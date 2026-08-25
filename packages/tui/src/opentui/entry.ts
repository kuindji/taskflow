import { startBackend } from "../backend/manager";
import { parseArgs } from "../cli";
import { WsClient } from "../net/client";
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
import type { ActionDefinition, FlowDefinition, Schedule, Task } from "@taskflow/shared";
import { OpenTuiApp } from "./app";
import { OpenTuiRuntimeOwner } from "./runtime";
import { SessionBridge } from "./session-bridge";

function editorActions(
    kind: "flow" | "action" | "schedule",
    actions: readonly ActionDefinition[],
    owner: SessionOwner,
): ActionDefinition[] {
    return kind === "schedule" ? [...actions] : visibleDefinitions(actions, owner);
}

async function main(): Promise<void> {
    const options = parseArgs(process.argv.slice(2));
    const owner = new OpenTuiRuntimeOwner();
    let app: OpenTuiApp | null = null;
    let store: Store | null = null;
    let controller: SessionController | null = null;
    let flowStore: FlowStore | null = null;
    let scheduleStore: ScheduleStore | null = null;
    let taskDetailStore: TaskDetailStore | null = null;
    let gitStore: GitStore | null = null;
    let settingsStore: SettingsStore | null = null;
    let notificationStore: NotificationStore | null = null;
    let finishing = false;

    const finish = async (code: number): Promise<void> => {
        if (finishing) return;
        finishing = true;
        app?.destroy();
        controller?.destroy();
        store?.dispose();
        flowStore?.dispose();
        scheduleStore?.dispose();
        taskDetailStore?.dispose();
        gitStore?.dispose();
        settingsStore?.dispose();
        notificationStore?.dispose();
        await owner.shutdown();
        process.exit(code);
    };

    try {
        let net: WsClient;
        if (options.connect === null) {
            const backend = await startBackend({
                binary: process.env.TASKFLOW_BACKEND_BIN ?? "taskflow-backend",
                args: [],
                devBranch: process.env.TASKFLOW_DEV_BRANCH ?? null,
                onSpawn: (stop) => owner.ownBackend({ stop }),
            });
            owner.ownBackend(backend);
            net = new WsClient(backend.port);
        } else {
            net = new WsClient(options.connect.port, options.connect.host);
        }
        owner.ownSocket(net);
        await net.connect();

        const renderer = await owner.create();
        store = new Store(net);
        flowStore = new FlowStore(net);
        scheduleStore = new ScheduleStore(net);
        taskDetailStore = new TaskDetailStore(net);
        gitStore = new GitStore(net);
        settingsStore = new SettingsStore(net);
        notificationStore = new NotificationStore(net, (notification) =>
            deliverNativeNotification(notification),
        );
        controller = new SessionController({
            createBridge: (session, sessionOwner) => {
                const pane = app?.paneDimensions ?? {
                    cols: Math.max(
                        1,
                        renderer.terminalWidth -
                            Math.min(30, Math.floor(renderer.terminalWidth / 3)),
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

        const externalEditorDeps = () => {
            const deps = defaultExternalEditorDeps(
                renderer,
                () => app?.blurForEditor(),
                () => app?.restoreAfterEditor(),
            );
            const configured = settingsStore?.editorCommand();
            if (configured) deps.editor = configured;
            return deps;
        };

        const editTaskText = async (
            task: Task,
            field: "description" | "notes",
        ): Promise<Task | null> => {
            if (!taskDetailStore) throw new Error("Task detail store unavailable");
            const activeTaskStore = taskDetailStore;
            let updated: Task | null = null;
            const result = await editRecord({
                filename: `${field}.txt`,
                initialContents: task[field],
                validate: (source) => source,
                save: async (source) => {
                    updated = await activeTaskStore.update({ id: task.id, [field]: source });
                },
                deps: externalEditorDeps(),
            });
            return result === null ? null : updated;
        };

        const editProductRecord = async (
            kind: "flow" | "action" | "schedule",
            record: FlowDefinition | ActionDefinition | Schedule | null,
            sessionOwner: SessionOwner,
        ): Promise<void> => {
            if (!flowStore || !scheduleStore) throw new Error("Product stores unavailable");
            const activeFlowStore = flowStore;
            const activeScheduleStore = scheduleStore;
            const projectId = ownerProjectId(sessionOwner);
            const visibleActions = editorActions(kind, activeFlowStore.actions, sessionOwner);
            const context = {
                projectId,
                projectIds: store?.projects.map((project) => project.id) ?? [],
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
                        actionRecord(parseActionDraft(source, context), existing ?? undefined),
                    save: (value) => activeFlowStore.saveAction(value),
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
                        flowRecord(parseFlowDraft(source, context), existing ?? undefined),
                    save: (value) => activeFlowStore.saveFlow(value),
                    deps,
                });
                return;
            }

            const existing = record as Schedule | null;
            const createProjectId = projectId ?? store?.projects[0]?.id;
            if (!existing && !createProjectId)
                throw new Error("Create a project before adding a schedule");
            const initial = existing ?? newScheduleDraft(createProjectId as string);
            const scheduleContext = {
                ...context,
                projectId: existing?.projectId ?? projectId,
            };
            await editRecord({
                filename: "schedule.yaml",
                initialContents: serializeSchedule(initial, !existing),
                validate: (source) => parseScheduleDraft(source, scheduleContext, !existing),
                save: async (draft) => {
                    const payload = schedulePayload(draft, existing ?? undefined);
                    if (existing)
                        await activeScheduleStore.update(
                            payload as import("@taskflow/shared").ScheduleUpdatePayload,
                        );
                    else
                        await activeScheduleStore.create(
                            payload as import("@taskflow/shared").ScheduleCreatePayload,
                        );
                },
                deps,
            });
        };
        app = new OpenTuiApp({
            renderer,
            net,
            store,
            flowStore,
            scheduleStore,
            taskStore: taskDetailStore,
            gitStore,
            settingsStore,
            notificationStore,
            onOwnerChange: (sessionOwner, sessions) =>
                controller?.reconcile(sessionOwner, sessions),
            onSessionSelect: (sessionId) => controller?.select(sessionId),
            onReconnect: () => controller?.reattach(),
            onCreate: (sessionOwner, payload) => {
                if (!controller) return Promise.reject(new Error("Session controller unavailable"));
                return controller.create(sessionOwner, payload);
            },
            onClose: (sessionId) => {
                if (!controller) return Promise.reject(new Error("Session controller unavailable"));
                return controller.close(sessionId);
            },
            onResume: (sessionId, cols, rows) => {
                if (!controller) return Promise.reject(new Error("Session controller unavailable"));
                return controller.resume(sessionId, cols, rows);
            },
            onRunAction: (sessionOwner, action) => actionRunner.run(sessionOwner, action),
            onEditRecord: editProductRecord,
            onEditTaskText: editTaskText,
            onFocusSession: (sessionId) => controller?.focusKnown(sessionId) ?? false,
            onQuit: () => void finish(0),
        });
        await app.init();
        renderer.requestRender();
    } catch (error) {
        app?.destroy();
        controller?.destroy();
        store?.dispose();
        flowStore?.dispose();
        scheduleStore?.dispose();
        taskDetailStore?.dispose();
        gitStore?.dispose();
        settingsStore?.dispose();
        notificationStore?.dispose();
        await owner.shutdown();
        const message = error instanceof Error ? error.stack || error.message : String(error);
        process.stderr.write(`${message}\n`);
        process.exit(1);
    }
}

export { editorActions, main };
