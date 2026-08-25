import {
    BoxRenderable,
    CliRenderEvents,
    TextAttributes,
    TextRenderable,
    type CliRenderer,
    type KeyEvent,
    type MouseEvent,
} from "@opentui/core";
import { MSG } from "@taskflow/shared";
import type {
    ActionDefinition,
    AgentListResponse,
    AppSettings,
    Project,
    Notification,
    SessionCreatePayload,
    SessionCreateResponse,
    SessionRef,
    SessionResumeResponse,
    ShellListResponse,
    SystemClientsEvent,
    SystemInfo,
    Task,
} from "@taskflow/shared";
import type { FlowDefinition, Schedule } from "@taskflow/shared";
import type { FlowStore } from "../flows/store";
import { visibleDefinitions, flowOwnerId, ownerProjectId } from "../flows/model";
import type { ScheduleStore } from "../schedules/store";
import type { GitStore } from "../git/store";
import type { GitChange } from "../git/model";
import type { SettingsStore } from "../settings/store";
import type { NotificationStore } from "../notifications/store";
import type { NetLike } from "../net/client";
import {
    repositoryPathForOwner,
    repositoryTargetIdForOwner,
    resolvedTaskAttributes,
} from "../tasks/model";
import type { TaskDetailStore } from "../tasks/store";
import {
    buildSessionCreatePayload,
    buildSessionPickerItems,
    type SessionPickerItem,
} from "../sessions/create-model";
import {
    MASTER_OWNER,
    ownerRequest,
    ownerKey,
    resolveOwner,
    sessionsForOwner,
    type SessionOwner,
} from "../sessions/owner";
import type { SessionBridge } from "./session-bridge";
import { Confirm } from "./confirm";
import { FlowInput } from "./flow-input";
import { FlowLibrary, type LibraryTab } from "./flow-library";
import { FlowRun } from "./flow-run";
import { GitChanges } from "./git-changes";
import { GitCommit } from "./git-commit";
import { Help } from "./help";
import { Schedules } from "./schedules";
import { SELECTED_TEXT_STYLE } from "./selection-style";
import { SessionPicker } from "./session-picker";
import { Settings } from "./settings";
import { Notifications } from "./notifications";
import { OwnerFilter } from "./owner-filter";
import { TaskCreate } from "./task-create";
import { TaskDetail } from "./task-detail";
import {
    KeyRouter,
    commandForUiKey,
    commandHint,
    prepareForEmbeddedTerminal,
    type FocusTarget,
    type UiCommand,
} from "./keys";

interface StoreLike {
    readonly masterSessions: readonly SessionRef[];
    readonly projects: readonly Project[];
    readonly tasks: readonly Task[];
    tasksFor(projectId: string): Task[];
    projectById(projectId: string): Project | null;
    taskById(taskId: string): Task | null;
    applyServerTask(task: Task): void;
    load(): Promise<void>;
    onChange(listener: () => void): () => void;
}

interface SessionBridgeLike {
    readonly renderable: SessionBridge["renderable"];
    attach(): Promise<void>;
    setActive(active: boolean, cols?: number, rows?: number): void;
    focus(): void;
    blur(): void;
    destroy(): void;
}

interface InjectedSession {
    id: string;
    label: string;
    type?: SessionRef["type"];
    state?: NonNullable<SessionRef["state"]>;
    nativeSessionId?: string;
    bridge: SessionBridgeLike;
}

interface OpenTuiAppDeps {
    renderer: CliRenderer;
    net: NetLike;
    store: StoreLike;
    sessions?: InjectedSession[];
    onOwnerChange?: (owner: SessionOwner, sessions: readonly SessionRef[]) => void;
    onSessionSelect?: (sessionId: string) => void;
    onReconnect?: () => void;
    onCreate?: (owner: SessionOwner, payload: SessionCreatePayload) => Promise<string>;
    onClose?: (sessionId: string) => Promise<void>;
    onResume?: (sessionId: string, cols: number, rows: number) => Promise<void>;
    flowStore?: FlowStore;
    scheduleStore?: ScheduleStore;
    taskStore?: TaskDetailStore;
    gitStore?: GitStore;
    settingsStore?: SettingsStore;
    notificationStore?: NotificationStore;
    onRunAction?: (owner: SessionOwner, action: ActionDefinition) => Promise<string>;
    onEditRecord?: (
        kind: "flow" | "action" | "schedule",
        record: FlowDefinition | ActionDefinition | Schedule | null,
        owner: SessionOwner,
    ) => Promise<void>;
    onFocusSession?: (sessionId: string) => boolean;
    onEditTaskText?: (task: Task, field: "description" | "notes") => Promise<Task | null>;
    onQuit?: () => void;
}

interface SidebarRow {
    kind: "master" | "project" | "task";
    id: string;
    owner: SessionOwner;
    label: string;
    sessionCount: number;
}

const ESCAPE_IDLE_MS = 25;

function cleanLabel(label: string): string {
    let result = "";
    for (const char of label) {
        const code = char.codePointAt(0) ?? 0;
        result += code < 0x20 || (code >= 0x7f && code <= 0x9f) ? "�" : char;
    }
    return result;
}

function buildRows(
    store: StoreLike,
    collapsedProjectIds: ReadonlySet<string> = new Set(),
    filter = "",
): SidebarRow[] {
    const query = filter.trim().toLowerCase();
    const masterRow: SidebarRow = {
        kind: "master",
        id: "master",
        owner: MASTER_OWNER,
        label: "Master Workspace",
        sessionCount: store.masterSessions.length,
    };
    const rows: SidebarRow[] =
        query === "" || masterRow.label.toLowerCase().includes(query) ? [masterRow] : [];
    for (const project of store.projects) {
        const label = cleanLabel(project.name);
        const tasks = store.tasksFor(project.id);
        const projectMatches = label.toLowerCase().includes(query);
        const matchingTasks =
            query === "" || projectMatches
                ? tasks
                : tasks.filter((task) => cleanLabel(task.title).toLowerCase().includes(query));
        if (query !== "" && !projectMatches && matchingTasks.length === 0) continue;
        rows.push({
            kind: "project",
            id: project.id,
            owner: { kind: "project", projectId: project.id },
            label,
            sessionCount: project.sessions.length,
        });
        if (query === "" && collapsedProjectIds.has(project.id)) continue;
        for (const task of matchingTasks) {
            rows.push({
                kind: "task",
                id: task.id,
                owner: { kind: "task", taskId: task.id, projectId: project.id },
                label: cleanLabel(task.title),
                sessionCount: task.sessions.length,
            });
        }
    }
    return rows;
}

function rowSignature(rows: readonly SidebarRow[]): string {
    return rows
        .map(
            (row) =>
                `${row.kind}\u0000${row.id}\u0000${row.label}\u0000${String(row.sessionCount)}`,
        )
        .join("\u0001");
}

class OpenTuiApp {
    readonly root: BoxRenderable;
    private readonly panels: BoxRenderable;
    private readonly sidebar: BoxRenderable;
    private readonly sidebarRowsBox: BoxRenderable;
    private readonly main: BoxRenderable;
    private readonly tabStrip: BoxRenderable;
    private readonly pane: BoxRenderable;
    private readonly footer: TextRenderable;
    private sessions: InjectedSession[];
    private readonly emptyState: TextRenderable;
    private readonly statusNotice: TextRenderable;
    private readonly keyRouter = new KeyRouter();
    private readonly disposers: Array<() => void> = [];
    private rows: SidebarRow[] = [];
    private rowsSignature = "";
    private selected = 0;
    private selectedOwnerState: SessionOwner = MASTER_OWNER;
    private activeSession = 0;
    private focusTarget: FocusTarget = "ui";
    private zoomed = false;
    private otherClients = 0;
    private clientsBroadcast = false;
    private escapeTimer: ReturnType<typeof setTimeout> | null = null;
    private destroyed = false;
    private picker: { view: SessionPicker; owner: SessionOwner } | null = null;
    private confirm: { view: Confirm; sessionId: string; ownerKey: string } | null = null;
    private readonly resumePending = new Set<string>();
    private readonly resumeErrors = new Map<string, string>();
    private mainView:
        | "sessions"
        | "task-detail"
        | "git-changes"
        | "settings"
        | "notifications"
        | "flow-library"
        | "flow-run"
        | "schedules" = "sessions";
    private productView:
        | TaskDetail
        | GitChanges
        | Settings
        | Notifications
        | FlowLibrary
        | FlowRun
        | Schedules
        | null = null;
    private taskCreate: TaskCreate | null = null;
    private gitCommit: GitCommit | null = null;
    private flowInput: FlowInput | null = null;
    private ownerFilter: OwnerFilter | null = null;
    private ownerFilterValue = "";
    private help: Help | null = null;
    private helpPreviousFocus: FocusTarget | null = null;
    private productConfirm: { view: Confirm; resolve(value: boolean): void } | null = null;
    private schedulerEnabled = false;
    private pendingFlowOwnerKey: string | null = null;
    private sidebarColumns = 30;
    private collapsedProjectIds = new Set<string>();

    constructor(private readonly deps: OpenTuiAppDeps) {
        this.sessions = deps.sessions ?? [];
        this.root = new BoxRenderable(deps.renderer, {
            id: "taskflow-root",
            width: "100%",
            height: "100%",
            flexDirection: "column",
        });
        this.panels = new BoxRenderable(deps.renderer, {
            id: "taskflow-panels",
            width: "100%",
            flexGrow: 1,
            flexDirection: "row",
            overflow: "hidden",
        });
        this.sidebar = new BoxRenderable(deps.renderer, {
            id: "sidebar",
            height: "100%",
            border: true,
            overflow: "hidden",
            onMouseScroll: (event) => {
                const direction = event.scroll?.direction;
                if (direction !== "up" && direction !== "down") return;
                event.preventDefault();
                event.stopPropagation();
                this.focusTarget = "ui";
                this.applyCommand({ kind: "move", delta: direction === "up" ? -1 : 1 });
                this.updateFocus();
            },
        });
        this.sidebarRowsBox = new BoxRenderable(deps.renderer, {
            id: "sidebar-rows",
            width: "100%",
            flexDirection: "column",
        });
        this.main = new BoxRenderable(deps.renderer, {
            id: "main",
            height: "100%",
            flexGrow: 1,
            flexDirection: "column",
            border: true,
            overflow: "hidden",
        });
        this.tabStrip = new BoxRenderable(deps.renderer, {
            id: "tabs",
            width: "100%",
            height: 1,
            flexDirection: "row",
            overflow: "hidden",
        });
        this.pane = new BoxRenderable(deps.renderer, {
            id: "session-pane",
            width: "100%",
            flexGrow: 1,
            overflow: "hidden",
        });
        this.emptyState = new TextRenderable(deps.renderer, {
            id: "empty-sessions",
            content: "No sessions. Press s to start one.",
            width: "100%",
            height: 1,
            selectable: false,
        });
        this.statusNotice = new TextRenderable(deps.renderer, {
            id: "session-status-notice",
            content: "",
            position: "absolute",
            top: 0,
            left: 0,
            width: "100%",
            height: 1,
            zIndex: 30,
            ...SELECTED_TEXT_STYLE,
            selectable: false,
            visible: false,
        });
        this.footer = new TextRenderable(deps.renderer, {
            id: "keyboard-footer",
            content: "",
            width: "100%",
            height: 1,
            flexShrink: 0,
            truncate: true,
            wrapMode: "none",
            attributes: TextAttributes.DIM,
            selectable: false,
        });

        this.sidebar.add(this.sidebarRowsBox);
        this.main.add(this.tabStrip);
        this.main.add(this.pane);
        this.panels.add(this.sidebar);
        this.panels.add(this.main);
        this.root.add(this.panels);
        this.root.add(this.footer);
        deps.renderer.root.add(this.root);
        for (const session of this.sessions) this.pane.add(session.bridge.renderable);
        if (this.sessions.length === 0) this.pane.add(this.emptyState);
        this.pane.add(this.statusNotice);

        const onKey = (event: KeyEvent) => this.handleKey(event);
        deps.renderer.keyInput.on("keypress", onKey);
        deps.renderer.keyInput.on("keyrelease", onKey);
        this.disposers.push(() => {
            deps.renderer.keyInput.off("keypress", onKey);
            deps.renderer.keyInput.off("keyrelease", onKey);
        });

        const onResize = () => this.applyLayout();
        deps.renderer.on(CliRenderEvents.RESIZE, onResize);
        this.disposers.push(() => deps.renderer.off(CliRenderEvents.RESIZE, onResize));
        this.applyLayout();
        this.rebuildTabs();
        this.updateSessionVisibility();
        this.updateFooter();
    }

    async init(): Promise<void> {
        this.disposers.push(
            this.deps.store.onChange(() => {
                this.refreshRows();
                this.focusPendingFlowSession();
            }),
        );
        this.disposers.push(
            this.deps.net.onStatusChange(({ connected }) => {
                if (!connected) return;
                void this.deps.store.load().catch(() => undefined);
                void this.loadSystemInfo().catch(() => undefined);
                void this.loadProducts().catch(() => undefined);
                if (this.deps.onReconnect) this.deps.onReconnect();
                else {
                    for (const session of this.sessions)
                        void session.bridge.attach().catch(() => undefined);
                }
            }),
        );
        if (this.deps.flowStore) {
            this.disposers.push(this.deps.flowStore.onChange(() => this.syncProductView()));
        }
        if (this.deps.scheduleStore) {
            this.disposers.push(this.deps.scheduleStore.onChange(() => this.syncProductView()));
        }
        if (this.deps.taskStore) {
            this.disposers.push(this.deps.taskStore.onChange(() => this.syncProductView()));
        }
        if (this.deps.gitStore) {
            this.disposers.push(this.deps.gitStore.onChange(() => this.syncProductView()));
        }
        if (this.deps.settingsStore) {
            this.disposers.push(
                this.deps.settingsStore.onChange(() => {
                    this.applyTuiSettings(this.deps.settingsStore?.settings ?? null);
                    this.syncProductView();
                }),
            );
        }
        if (this.deps.notificationStore) {
            this.disposers.push(
                this.deps.notificationStore.onChange(() => {
                    this.syncProductView();
                    this.updateFooter();
                }),
            );
        }
        this.disposers.push(
            this.deps.net.on(MSG.SYSTEM_CLIENTS, (payload) => {
                this.clientsBroadcast = true;
                this.setOtherClients(Math.max(0, (payload as SystemClientsEvent).count - 1));
            }),
        );

        const clientCount = this.deps.net
            .request<SystemClientsEvent>(MSG.SYSTEM_CLIENTS)
            .then((event) => {
                if (!this.clientsBroadcast) this.setOtherClients(Math.max(0, event.count - 1));
            })
            .catch(() => undefined);
        const systemInfo = this.loadSystemInfo().catch(() => undefined);
        await this.deps.store.load();
        await Promise.all([systemInfo, this.loadProducts()]);
        await clientCount;
        this.refreshRows(true);
    }

    private async loadSystemInfo(): Promise<void> {
        const info = await this.deps.net.request<SystemInfo>(MSG.SYSTEM_INFO);
        this.schedulerEnabled = info.schedulerEnabled;
        if (this.mainView === "schedules") this.openSchedules();
    }

    private async loadProducts(): Promise<void> {
        const loads: Promise<void>[] = [];
        if (this.deps.flowStore) loads.push(this.deps.flowStore.loadDefinitions());
        if (this.deps.settingsStore) loads.push(this.deps.settingsStore.loadSettings());
        if (this.deps.notificationStore) loads.push(this.deps.notificationStore.load());
        loads.push(this.loadOwnerProducts());
        await Promise.all(loads);
    }

    private async loadOwnerProducts(): Promise<void> {
        await Promise.all([
            this.deps.flowStore?.loadRun(this.selectedOwnerState) ?? Promise.resolve(),
            this.deps.scheduleStore?.load(ownerProjectId(this.selectedOwnerState) ?? undefined) ??
                Promise.resolve(),
            this.selectedOwnerState.kind === "task" && this.mainView === "task-detail"
                ? (this.deps.taskStore?.loadLogs(this.selectedOwnerState.taskId) ??
                  Promise.resolve())
                : Promise.resolve(),
            this.mainView === "git-changes" ? this.loadSelectedRepository() : Promise.resolve(),
        ]);
    }

    private loadSelectedRepository(): Promise<void> {
        const path = repositoryPathForOwner(this.selectedOwnerState, this.deps.store);
        const targetId = repositoryTargetIdForOwner(this.selectedOwnerState, this.deps.store);
        if (!path || !targetId || !this.deps.gitStore) return Promise.resolve();
        return this.deps.gitStore.loadStatus(path, targetId);
    }

    private refreshRows(force = false): void {
        const rows = buildRows(this.deps.store, this.collapsedProjectIds, this.ownerFilterValue);
        const signature = rowSignature(rows);
        const previousOwnerKey = ownerKey(this.selectedOwnerState);
        if (
            this.ownerFilterValue === "" &&
            this.selectedOwnerState.kind === "task" &&
            this.collapsedProjectIds.has(this.selectedOwnerState.projectId)
        ) {
            this.selectedOwnerState = {
                kind: "project",
                projectId: this.selectedOwnerState.projectId,
            };
        }
        this.selectedOwnerState = resolveOwner(this.deps.store, this.selectedOwnerState);
        if (
            rows.length > 0 &&
            !rows.some((row) => ownerKey(row.owner) === ownerKey(this.selectedOwnerState))
        ) {
            this.selectedOwnerState = rows[0].owner;
        }
        const ownerChanged = previousOwnerKey !== ownerKey(this.selectedOwnerState);
        if (
            this.picker &&
            ownerKey(resolveOwner(this.deps.store, this.picker.owner)) !==
                ownerKey(this.picker.owner)
        ) {
            this.closeSessionPicker(this.picker.view);
        }
        this.deps.onOwnerChange?.(
            this.selectedOwnerState,
            sessionsForOwner(this.deps.store, this.selectedOwnerState),
        );
        if (ownerChanged) {
            this.deps.taskStore?.selectTask(
                this.selectedOwnerState.kind === "task" ? this.selectedOwnerState.taskId : null,
            );
            void this.loadOwnerProducts().catch(() => undefined);
            if (this.mainView === "task-detail") {
                if (this.selectedOwnerState.kind === "task") this.openTaskDetail();
                else this.showSessions();
            } else if (this.mainView === "git-changes") this.openGitChanges();
            else if (this.mainView === "settings") this.syncProductView();
            else if (this.mainView === "flow-run") this.openFlowLibrary();
            else this.syncProductView();
        }
        if (!ownerChanged && this.productView) this.syncProductView();
        if (!force && signature === this.rowsSignature && !ownerChanged) return;
        this.rows = rows;
        this.rowsSignature = signature;
        const selectedKey = ownerKey(this.selectedOwnerState);
        const selectedIndex = rows.findIndex((row) => ownerKey(row.owner) === selectedKey);
        this.selected = selectedIndex === -1 ? 0 : selectedIndex;
        this.rebuildSidebar();
        this.deps.renderer.requestRender();
    }

    private applyTuiSettings(settings: AppSettings | null): void {
        if (!settings) return;
        this.sidebarColumns = Math.min(
            60,
            Math.max(16, Math.round(settings.layout.panels.sidebarWidth / 8)),
        );
        this.collapsedProjectIds = new Set(settings.layout.panels.collapsedProjectIds);
        this.refreshRows(true);
        this.applyLayout();
    }

    private clearChildren(parent: BoxRenderable): void {
        for (const child of [...parent.getChildren()]) child.destroy();
    }

    private rebuildSidebar(): void {
        this.clearChildren(this.sidebarRowsBox);
        for (const [index, row] of this.rows.entries()) {
            const attrs = row.kind !== "task" ? TextAttributes.BOLD : 0;
            const container = new BoxRenderable(this.deps.renderer, {
                width: "100%",
                height: 1,
                flexDirection: "row",
                onMouseDown: (event) => this.selectSidebarRow(index, event),
            });
            const badge = row.sessionCount > 0 ? ` ${String(row.sessionCount)}` : "";
            const label = new TextRenderable(this.deps.renderer, {
                content: `${row.kind === "task" ? "  " : ""}${row.label}`,
                height: 1,
                flexGrow: 1,
                flexShrink: 1,
                truncate: true,
                wrapMode: "none",
                selectable: false,
                attributes: attrs,
                ...(index === this.selected ? SELECTED_TEXT_STYLE : {}),
            });
            container.add(label);
            if (badge !== "") {
                container.add(
                    new TextRenderable(this.deps.renderer, {
                        content: badge,
                        width: badge.length,
                        height: 1,
                        flexShrink: 0,
                        selectable: false,
                        attributes: attrs,
                        ...(index === this.selected ? SELECTED_TEXT_STYLE : {}),
                    }),
                );
            }
            this.sidebarRowsBox.add(container);
        }
        this.keepSelectionVisible();
    }

    private rebuildTabs(): void {
        this.clearChildren(this.tabStrip);
        for (const [index, session] of this.sessions.entries()) {
            this.tabStrip.add(
                new TextRenderable(this.deps.renderer, {
                    content: ` ${cleanLabel(session.label)}${
                        session.state === "interrupted"
                            ? " [interrupted]"
                            : session.state === "resuming"
                              ? " [resuming]"
                              : ""
                    } `,
                    height: 1,
                    flexShrink: 0,
                    truncate: true,
                    wrapMode: "none",
                    selectable: false,
                    ...(index === this.activeSession ? SELECTED_TEXT_STYLE : {}),
                    onMouseDown: (event) => this.selectSession(index, event),
                }),
            );
        }
        if (this.otherClients > 0) {
            const text = ` ${String(this.otherClients)} other client(s) attached `;
            this.tabStrip.add(
                new TextRenderable(this.deps.renderer, {
                    id: "client-warning",
                    content: text,
                    width: text.length,
                    height: 1,
                    position: "absolute",
                    right: 0,
                    top: 0,
                    zIndex: 10,
                    ...SELECTED_TEXT_STYLE,
                    selectable: false,
                    onMouseDown: (event) => {
                        event.preventDefault();
                        event.stopPropagation();
                    },
                }),
            );
        }
    }

    private setOtherClients(count: number): void {
        if (count === this.otherClients) return;
        this.otherClients = count;
        this.rebuildTabs();
        this.deps.renderer.requestRender();
    }

    private selectSidebarRow(index: number, event?: MouseEvent): void {
        if (index < 0 || index >= this.rows.length) return;
        event?.preventDefault();
        event?.stopPropagation();
        const changed = index !== this.selected;
        this.selected = index;
        this.selectedOwnerState = this.rows[index].owner;
        this.focusTarget = "ui";
        if (changed) this.rebuildSidebar();
        if (changed) {
            this.deps.onOwnerChange?.(
                this.selectedOwnerState,
                sessionsForOwner(this.deps.store, this.selectedOwnerState),
            );
            if (this.mainView === "flow-run") this.openFlowLibrary();
            else this.syncProductView();
            void this.loadOwnerProducts().then(() => {
                if (this.mainView === "flow-run") this.openFlowProduct();
                else this.syncProductView();
            });
        }
        this.updateFocus();
        this.deps.renderer.requestRender();
    }

    private selectSession(index: number, event?: MouseEvent): void {
        if (index < 0 || index >= this.sessions.length) return;
        event?.preventDefault();
        event?.stopPropagation();
        if (index === this.activeSession && this.focusTarget === "session") return;
        this.activeSession = index;
        this.deps.onSessionSelect?.(this.sessions[index].id);
        this.focusTarget = "session";
        this.rebuildTabs();
        this.updateSessionVisibility();
        this.updateStatusNotice();
        this.updateFocus();
        this.deps.renderer.requestRender();
    }

    private handleKey(event: KeyEvent): void {
        if (this.productConfirm) {
            event.preventDefault();
            event.stopPropagation();
            this.productConfirm.view.handleKey(event);
            this.updateFooter();
            return;
        }
        if (this.confirm) {
            event.preventDefault();
            event.stopPropagation();
            this.confirm.view.handleKey(event);
            this.updateFooter();
            return;
        }
        if (this.picker) {
            event.preventDefault();
            event.stopPropagation();
            this.picker.view.handleKey(event);
            this.updateFooter();
            return;
        }
        if (this.taskCreate) {
            event.preventDefault();
            event.stopPropagation();
            this.taskCreate.handleKey(event);
            this.updateFooter();
            return;
        }
        if (this.gitCommit) {
            event.preventDefault();
            event.stopPropagation();
            this.gitCommit.handleKey(event);
            this.updateFooter();
            return;
        }
        if (this.flowInput) {
            event.preventDefault();
            event.stopPropagation();
            this.flowInput.handleKey(event);
            this.updateFooter();
            return;
        }
        if (this.ownerFilter) {
            event.preventDefault();
            event.stopPropagation();
            this.ownerFilter.handleKey(event);
            this.updateFooter();
            return;
        }
        if (this.help) {
            event.preventDefault();
            event.stopPropagation();
            this.help.handleKey(event);
            this.updateFooter();
            return;
        }
        if (this.mainView !== "sessions" && this.productView) {
            if (commandForUiKey(event)?.kind === "help") {
                event.preventDefault();
                event.stopPropagation();
                this.openHelp();
                return;
            }
            event.preventDefault();
            event.stopPropagation();
            this.productView.handleKey(event);
            this.updateFooter();
            return;
        }
        if (this.escapeTimer !== null) {
            clearTimeout(this.escapeTimer);
            this.escapeTimer = null;
        }
        const route = this.keyRouter.route(this.focusTarget, event);
        if (route.kind === "pass") {
            if (route.before) {
                this.activeBridge()?.renderable.handleKeyPress(
                    prepareForEmbeddedTerminal(route.before),
                );
            }
            prepareForEmbeddedTerminal(event);
            return;
        }

        event.preventDefault();
        event.stopPropagation();
        if (route.kind === "hold-escape") {
            this.escapeTimer = setTimeout(() => {
                this.escapeTimer = null;
                const held = this.keyRouter.takeHeldEscape();
                if (held && this.focusTarget === "session") {
                    this.activeBridge()?.renderable.handleKeyPress(
                        prepareForEmbeddedTerminal(held),
                    );
                }
            }, ESCAPE_IDLE_MS);
            return;
        }
        if (route.kind === "switch-focus") {
            this.focusTarget = this.focusTarget === "ui" ? "session" : "ui";
            this.updateFocus();
            this.updateFooter();
            this.deps.renderer.requestRender();
            return;
        }
        if (route.kind === "command") this.applyCommand(route.command);
    }

    private applyCommand(command: UiCommand): void {
        switch (command.kind) {
            case "move":
                if (this.rows.length === 0) return;
                this.selected = Math.max(
                    0,
                    Math.min(this.rows.length - 1, this.selected + command.delta),
                );
                this.selectedOwnerState = this.rows[this.selected].owner;
                this.rebuildSidebar();
                this.deps.onOwnerChange?.(
                    this.selectedOwnerState,
                    sessionsForOwner(this.deps.store, this.selectedOwnerState),
                );
                if (this.mainView === "flow-run") this.openFlowLibrary();
                else this.syncProductView();
                void this.loadOwnerProducts().then(() => this.syncProductView());
                break;
            case "select-tab":
                if (command.index >= this.sessions.length) return;
                this.activeSession = command.index;
                this.deps.onSessionSelect?.(this.sessions[command.index].id);
                this.rebuildTabs();
                this.updateSessionVisibility();
                this.updateStatusNotice();
                break;
            case "open":
                if (this.sessions.length > 0) {
                    this.focusTarget = "session";
                    this.updateFocus();
                } else {
                    this.openTaskDetail();
                }
                break;
            case "create":
                this.openSessionPicker();
                break;
            case "close":
                this.openCloseConfirm();
                break;
            case "resume":
                this.resumeActiveSession();
                break;
            case "flows":
                this.openFlowProduct();
                break;
            case "schedules":
                this.openSchedules();
                break;
            case "task-detail":
                this.openTaskDetail();
                break;
            case "task-create":
                this.openTaskCreate();
                break;
            case "git":
                this.openGitChanges();
                break;
            case "settings":
                this.openSettings();
                break;
            case "notifications":
                this.openNotifications();
                break;
            case "filter":
                this.openOwnerFilter();
                break;
            case "help":
                this.openHelp();
                break;
            case "zoom":
                this.zoomed = !this.zoomed;
                this.applyLayout();
                break;
            case "quit":
                this.deps.onQuit?.();
                break;
            default:
                break;
        }
        this.updateFooter();
        this.deps.renderer.requestRender();
    }

    private mountProduct(
        view:
            | TaskDetail
            | GitChanges
            | Settings
            | Notifications
            | FlowLibrary
            | FlowRun
            | Schedules,
        kind: typeof this.mainView,
    ): void {
        this.productView?.destroy();
        this.productView = view;
        this.mainView = kind;
        this.tabStrip.visible = false;
        this.pane.add(view.renderable);
        this.focusTarget = "ui";
        this.updateSessionVisibility();
        this.updateFooter();
        this.deps.renderer.requestRender();
    }

    private openHelp(): void {
        if (this.help) return;
        this.helpPreviousFocus = this.focusTarget;
        const view = new Help({
            renderer: this.deps.renderer,
            onClose: () => this.closeHelp(),
            onStateChange: () => {
                this.updateFooter();
                this.deps.renderer.requestRender();
            },
        });
        this.help = view;
        this.pane.add(view.renderable);
        this.focusTarget = "ui";
        this.updateSessionVisibility();
        this.updateFooter();
        this.deps.renderer.requestRender();
    }

    private openOwnerFilter(): void {
        if (this.ownerFilter) return;
        const view = new OwnerFilter({
            renderer: this.deps.renderer,
            initialValue: this.ownerFilterValue,
            onCancel: () => this.closeOwnerFilter(view),
            onSubmit: (value) => {
                this.ownerFilterValue = value;
                this.closeOwnerFilter(view);
                this.refreshRows(true);
            },
            onStateChange: () => {
                this.updateFooter();
                this.deps.renderer.requestRender();
            },
        });
        this.ownerFilter = view;
        this.root.add(view.renderable);
        this.updateFooter();
        this.deps.renderer.requestRender();
    }

    private closeOwnerFilter(view: OwnerFilter): void {
        if (this.ownerFilter !== view) return;
        this.ownerFilter = null;
        view.destroy();
        this.updateFooter();
        this.deps.renderer.requestRender();
    }

    private closeHelp(): void {
        const view = this.help;
        if (!view) return;
        this.help = null;
        view.destroy();
        this.focusTarget = this.helpPreviousFocus ?? "ui";
        this.helpPreviousFocus = null;
        this.updateSessionVisibility();
        this.updateFooter();
        this.deps.renderer.requestRender();
    }

    private showSessions(focusSession = false): void {
        if (this.gitCommit) {
            this.gitCommit.destroy();
            this.gitCommit = null;
        }
        this.productView?.destroy();
        this.productView = null;
        this.mainView = "sessions";
        this.deps.taskStore?.selectTask(null);
        this.tabStrip.visible = true;
        this.focusTarget = focusSession && this.sessions.length > 0 ? "session" : "ui";
        this.updateSessionVisibility();
        this.updateFooter();
        this.deps.renderer.requestRender();
    }

    private openTaskDetail(): void {
        if (this.selectedOwnerState.kind !== "task") return;
        const task = this.deps.store.taskById(this.selectedOwnerState.taskId);
        if (!task) return;
        const project = this.deps.store.projectById(task.projectId);
        const attributes = resolvedTaskAttributes(task, this.deps.store);
        const view = new TaskDetail({
            renderer: this.deps.renderer,
            task,
            project,
            attributes,
            logs: this.deps.taskStore?.logsFor(task.id) ?? [],
            onEditTitle: (title) => void this.updateTaskTitle(view, task.id, title),
            onEditDescription: () => void this.editTaskText(view, task.id, "description"),
            onEditNotes: () => void this.editTaskText(view, task.id, "notes"),
            onCreateAttribute: (name, value) =>
                void this.createTaskAttribute(view, task.id, name, value),
            onUpdateAttribute: (attribute, value) =>
                void this.updateTaskAttribute(view, task.id, attribute.id, value),
            onDeleteAttribute: (attribute) =>
                void this.deleteTaskAttribute(view, task.id, attribute.id),
            onTogglePin: () => void this.toggleTaskPin(view, task.id),
            onArchive: () => void this.archiveTask(view, task.id),
            onClose: () => this.showSessions(),
            onStateChange: () => this.updateFooter(),
        });
        this.deps.taskStore?.selectTask(task.id);
        this.mountProduct(view, "task-detail");
        void this.deps.taskStore?.loadLogs(task.id).catch((error: unknown) => {
            if (this.productView === view) {
                view.setError(`Could not load task activity: ${this.errorMessage(error)}`);
            }
        });
    }

    private async editTaskText(
        view: TaskDetail,
        taskId: string,
        field: "description" | "notes",
    ): Promise<void> {
        if (this.productView !== view || !this.deps.onEditTaskText) return;
        const task = this.deps.store.taskById(taskId);
        if (!task) return;
        if (!(await this.confirmTerminalEditor(`${field}.txt`))) return;
        view.setPending(true);
        try {
            const updated = await this.deps.onEditTaskText(task, field);
            if (updated) this.deps.store.applyServerTask(updated);
            else view.setPending(false);
        } catch (error) {
            view.setError(`Could not edit task: ${this.errorMessage(error)}`);
        }
    }

    private async updateTaskTitle(view: TaskDetail, taskId: string, title: string): Promise<void> {
        if (this.productView !== view || !this.deps.taskStore) return;
        try {
            this.deps.store.applyServerTask(
                await this.deps.taskStore.update({ id: taskId, title }),
            );
        } catch (error) {
            view.setError(`Could not update task: ${this.errorMessage(error)}`);
        }
    }

    private async createTaskAttribute(
        view: TaskDetail,
        taskId: string,
        name: string,
        value: string,
    ): Promise<void> {
        if (this.productView !== view || !this.deps.taskStore) return;
        try {
            this.deps.store.applyServerTask(
                await this.deps.taskStore.createAttribute({ taskId, name, value }),
            );
        } catch (error) {
            view.setError(`Could not create attribute: ${this.errorMessage(error)}`);
        }
    }

    private async updateTaskAttribute(
        view: TaskDetail,
        taskId: string,
        attrId: string,
        value: string,
    ): Promise<void> {
        if (this.productView !== view || !this.deps.taskStore) return;
        try {
            this.deps.store.applyServerTask(
                await this.deps.taskStore.updateAttribute({ taskId, attrId, value }),
            );
        } catch (error) {
            view.setError(`Could not update attribute: ${this.errorMessage(error)}`);
        }
    }

    private async deleteTaskAttribute(
        view: TaskDetail,
        taskId: string,
        attrId: string,
    ): Promise<void> {
        if (this.productView !== view || !this.deps.taskStore) return;
        try {
            this.deps.store.applyServerTask(
                await this.deps.taskStore.deleteAttribute({ taskId, attrId }),
            );
        } catch (error) {
            view.setError(`Could not delete attribute: ${this.errorMessage(error)}`);
        }
    }

    private async toggleTaskPin(view: TaskDetail, taskId: string): Promise<void> {
        if (this.productView !== view || !this.deps.taskStore) return;
        const task = this.deps.store.taskById(taskId);
        if (!task) return;
        view.setPending(true);
        try {
            this.deps.store.applyServerTask(
                await this.deps.taskStore.update({ id: task.id, pinned: !task.pinned }),
            );
        } catch (error) {
            view.setError(`Could not update task: ${this.errorMessage(error)}`);
        }
    }

    private async archiveTask(view: TaskDetail, taskId: string): Promise<void> {
        if (this.productView !== view || !this.deps.taskStore) return;
        const task = this.deps.store.taskById(taskId);
        if (!task) return;
        const confirmed = await this.askProductConfirm(
            "Archive task",
            `Archive ${task.title}? This closes its sessions and active flows.`,
        );
        if (!confirmed || this.productView !== view) return;
        view.setPending(true);
        try {
            const archived = await this.deps.taskStore.archive(task.id);
            this.selectedOwnerState = { kind: "project", projectId: task.projectId };
            this.showSessions();
            this.deps.store.applyServerTask(archived);
        } catch (error) {
            view.setError(`Could not archive task: ${this.errorMessage(error)}`);
        }
    }

    private openTaskCreate(): void {
        if (this.taskCreate || this.picker || this.confirm) return;
        let projectId: string;
        let parentId: string | undefined;
        if (this.selectedOwnerState.kind === "master") {
            this.showCommandNotice(" Select a project or top-level task before creating a task.");
            return;
        }
        if (this.selectedOwnerState.kind === "project") {
            projectId = this.selectedOwnerState.projectId;
        } else {
            const task = this.deps.store.taskById(this.selectedOwnerState.taskId);
            if (!task || task.parentId) {
                this.showCommandNotice(" Subtasks cannot have child tasks.");
                return;
            }
            projectId = task.projectId;
            parentId = task.id;
        }
        const view = new TaskCreate({
            renderer: this.deps.renderer,
            projectId,
            parentId,
            onCancel: () => this.closeTaskCreate(view),
            onSubmit: (payload) => void this.submitTaskCreate(view, payload),
            onStateChange: () => this.updateFooter(),
        });
        this.taskCreate = view;
        this.root.add(view.renderable);
        this.deps.renderer.requestRender();
    }

    private async submitTaskCreate(
        view: TaskCreate,
        payload: import("@taskflow/shared").TaskCreatePayload,
    ): Promise<void> {
        if (this.taskCreate !== view || !this.deps.taskStore) return;
        try {
            const created = await this.deps.taskStore.create(payload);
            this.selectedOwnerState = {
                kind: "task",
                taskId: created.id,
                projectId: created.projectId,
            };
            this.closeTaskCreate(view);
            this.deps.store.applyServerTask(created);
            this.openTaskDetail();
        } catch (error) {
            view.setError(`Could not create task: ${this.errorMessage(error)}`);
        }
    }

    private closeTaskCreate(view: TaskCreate): void {
        if (this.taskCreate !== view) return;
        this.taskCreate = null;
        view.destroy();
        this.updateFooter();
        this.deps.renderer.requestRender();
    }

    private showCommandNotice(message: string): void {
        this.statusNotice.content = message;
        this.statusNotice.visible = true;
        this.updateFooter();
        this.deps.renderer.requestRender();
    }

    private openSettings(): void {
        const store = this.deps.settingsStore;
        if (!store) return;
        const view = new Settings({
            renderer: this.deps.renderer,
            settings: store.settings,
            choices: store.choices,
            projects: this.deps.store.projects,
            onSave: (item, value) => void this.saveSetting(view, item.payload(value)),
            onClose: () => this.showSessions(),
            onStateChange: () => this.updateFooter(),
        });
        this.mountProduct(view, "settings");
        void store.load().catch((error: unknown) => {
            if (this.productView === view) {
                view.setError(`Could not load settings: ${this.errorMessage(error)}`);
            }
        });
    }

    private async saveSetting(
        view: Settings,
        payload: import("@taskflow/shared").SettingsUpdatePayload,
    ): Promise<void> {
        if (this.productView !== view || !this.deps.settingsStore) return;
        try {
            await this.deps.settingsStore.update(payload);
        } catch (error) {
            view.setError(`Could not save setting: ${this.errorMessage(error)}`);
        }
    }

    private openNotifications(): void {
        const store = this.deps.notificationStore;
        if (!store) return;
        const view = new Notifications({
            renderer: this.deps.renderer,
            notifications: store.notifications,
            onOpen: (notification) => this.navigateNotification(notification),
            onMarkRead: (notification) => void this.markNotificationRead(view, notification),
            onMarkAllRead: () => void this.markAllNotificationsRead(view),
            onClearRead: () => void this.clearReadNotifications(view),
            onClose: () => this.showSessions(),
            onStateChange: () => this.updateFooter(),
        });
        this.mountProduct(view, "notifications");
    }

    private async markNotificationRead(
        view: Notifications,
        notification: Notification,
    ): Promise<void> {
        if (this.productView !== view || !this.deps.notificationStore) return;
        if (notification.read) return;
        view.setPending(true);
        try {
            await this.deps.notificationStore.markRead(notification.id);
        } catch (error) {
            view.setError(`Could not mark notification read: ${this.errorMessage(error)}`);
        }
    }

    private async markAllNotificationsRead(view: Notifications): Promise<void> {
        if (this.productView !== view || !this.deps.notificationStore) return;
        view.setPending(true);
        try {
            await this.deps.notificationStore.markAllRead();
            if (this.deps.notificationStore.unreadCount === 0) view.setPending(false);
        } catch (error) {
            view.setError(`Could not mark notifications read: ${this.errorMessage(error)}`);
        }
    }

    private async clearReadNotifications(view: Notifications): Promise<void> {
        if (this.productView !== view || !this.deps.notificationStore) return;
        view.setPending(true);
        try {
            await this.deps.notificationStore.clearRead();
            view.setPending(false);
        } catch (error) {
            view.setError(`Could not clear notifications: ${this.errorMessage(error)}`);
        }
    }

    private navigateNotification(notification: Notification): void {
        if (!notification.read) void this.deps.notificationStore?.markRead(notification.id);
        const task = notification.taskId ? this.deps.store.taskById(notification.taskId) : null;
        if (task?.status === "active") {
            this.selectedOwnerState = {
                kind: "task",
                taskId: task.id,
                projectId: task.projectId,
            };
        } else if (this.deps.store.projectById(notification.projectId)) {
            this.selectedOwnerState = { kind: "project", projectId: notification.projectId };
        }
        this.refreshRows(true);
        this.showSessions();
        if (this.deps.onFocusSession?.(notification.sessionId)) {
            this.focusTarget = "session";
            this.updateSessionVisibility();
        }
    }

    private openGitChanges(): void {
        const store = this.deps.gitStore;
        const path = repositoryPathForOwner(this.selectedOwnerState, this.deps.store);
        const targetId = repositoryTargetIdForOwner(this.selectedOwnerState, this.deps.store);
        if (!store || !path || !targetId) {
            this.showCommandNotice(" The selected owner has no repository.");
            return;
        }
        const current = store.path === path;
        const view = new GitChanges({
            renderer: this.deps.renderer,
            status: current ? store.status : null,
            diff: current ? store.diff : null,
            onSelect: (change) => void this.loadGitDiff(view, change),
            onStage: (change) => void this.mutateGitFile(view, "stage", change),
            onUnstage: (change) => void this.mutateGitFile(view, "unstage", change),
            onStageAll: () => void this.mutateAllGit(view, "stage"),
            onUnstageAll: () => void this.mutateAllGit(view, "unstage"),
            onCommit: () => this.openGitCommit(view),
            onClose: () => this.showSessions(),
            onStateChange: () => this.updateFooter(),
        });
        this.mountProduct(view, "git-changes");
        if (view.selectedChange) void this.loadGitDiff(view, view.selectedChange);
        void store.loadStatus(path, targetId).catch((error: unknown) => {
            if (this.productView === view) {
                view.setError(`Could not load Git status: ${this.errorMessage(error)}`);
            }
        });
    }

    private async loadGitDiff(view: GitChanges, change: GitChange): Promise<void> {
        if (this.productView !== view || !this.deps.gitStore) return;
        try {
            await this.deps.gitStore.loadDiff(change);
        } catch (error) {
            view.setError(`Could not load diff: ${this.errorMessage(error)}`);
        }
    }

    private async mutateGitFile(
        view: GitChanges,
        operation: "stage" | "unstage",
        change: GitChange,
    ): Promise<void> {
        if (this.productView !== view || !this.deps.gitStore) return;
        view.setPending(true);
        try {
            if (operation === "stage") await this.deps.gitStore.stage(change);
            else await this.deps.gitStore.unstage(change);
        } catch (error) {
            view.setError(`Could not ${operation} file: ${this.errorMessage(error)}`);
        }
    }

    private async mutateAllGit(view: GitChanges, operation: "stage" | "unstage"): Promise<void> {
        if (this.productView !== view || !this.deps.gitStore) return;
        const confirmed = await this.askProductConfirm(
            operation === "stage" ? "Stage all files" : "Unstage all files",
            `${operation === "stage" ? "Stage" : "Unstage"} every changed file?`,
        );
        if (!confirmed || this.productView !== view) return;
        view.setPending(true);
        try {
            if (operation === "stage") await this.deps.gitStore.stage();
            else await this.deps.gitStore.unstage();
        } catch (error) {
            view.setError(`Could not ${operation} files: ${this.errorMessage(error)}`);
        }
    }

    private openGitCommit(view: GitChanges): void {
        if (this.productView !== view || this.gitCommit) return;
        if (!this.deps.gitStore?.status?.stagedFiles.length) {
            view.setError("Stage at least one file before committing.");
            return;
        }
        const commit = new GitCommit({
            renderer: this.deps.renderer,
            onCancel: () => this.closeGitCommit(commit),
            onGenerate: () => void this.generateGitCommitMessage(commit),
            onSubmit: (message) => void this.submitGitCommit(commit, message),
            onStateChange: () => this.updateFooter(),
        });
        this.gitCommit = commit;
        this.root.add(commit.renderable);
        this.updateFooter();
        this.deps.renderer.requestRender();
    }

    private async generateGitCommitMessage(view: GitCommit): Promise<void> {
        if (this.gitCommit !== view || !this.deps.gitStore) return;
        try {
            view.setGenerated(await this.deps.gitStore.generateMessage());
        } catch (error) {
            view.setError(`Could not generate message: ${this.errorMessage(error)}`);
        }
    }

    private async submitGitCommit(view: GitCommit, message: string): Promise<void> {
        if (this.gitCommit !== view || !this.deps.gitStore) return;
        try {
            await this.deps.gitStore.commit(message);
            this.closeGitCommit(view);
        } catch (error) {
            view.setError(`Could not commit: ${this.errorMessage(error)}`);
        }
    }

    private closeGitCommit(view: GitCommit): void {
        if (this.gitCommit !== view) return;
        this.gitCommit = null;
        view.destroy();
        this.updateFooter();
        this.deps.renderer.requestRender();
    }

    private openFlowProduct(): void {
        const run = this.deps.flowStore?.runFor(this.selectedOwnerState);
        if (run) this.openFlowRun();
        else this.openFlowLibrary();
    }

    private openFlowLibrary(): void {
        const store = this.deps.flowStore;
        if (!store) return;
        const flows = visibleDefinitions(store.flows, this.selectedOwnerState);
        const actions = visibleDefinitions(store.actions, this.selectedOwnerState);
        const view = new FlowLibrary({
            renderer: this.deps.renderer,
            flows,
            actions,
            onStartFlow: (flow) => this.startFlow(flow),
            onRunAction: (action) => this.runAction(action),
            onCreate: (tab) => void this.editLibraryRecord(tab, null),
            onEdit: (record, tab) => void this.editLibraryRecord(tab, record),
            onDelete: (record, tab) => void this.deleteLibraryRecord(tab, record),
            onViewRun: () => this.openFlowRun(),
            onClose: () => this.showSessions(),
            onStateChange: () => this.updateFooter(),
        });
        this.mountProduct(view, "flow-library");
    }

    private startFlow(flow: FlowDefinition): void {
        if (!this.deps.flowStore) return;
        if (flow.inputs?.length) {
            const input = new FlowInput({
                renderer: this.deps.renderer,
                inputs: flow.inputs,
                onCancel: () => this.closeFlowInput(input),
                onSubmit: (values) => {
                    this.closeFlowInput(input);
                    void this.submitFlow(flow, values);
                },
                onStateChange: () => this.updateFooter(),
            });
            this.flowInput = input;
            this.root.add(input.renderable);
            this.deps.renderer.requestRender();
            return;
        }
        void this.submitFlow(flow);
    }

    private closeFlowInput(view: FlowInput): void {
        if (this.flowInput !== view) return;
        this.flowInput = null;
        view.destroy();
        this.updateFooter();
        this.deps.renderer.requestRender();
    }

    private async submitFlow(
        flow: FlowDefinition,
        inputValues?: Record<string, string>,
    ): Promise<void> {
        const library = this.productView instanceof FlowLibrary ? this.productView : null;
        library?.setPending(true);
        try {
            await this.deps.flowStore?.startFlow({
                ...ownerRequest(this.selectedOwnerState),
                flowId: flow.id,
                inputValues,
            });
            this.pendingFlowOwnerKey = ownerKey(this.selectedOwnerState);
            this.showSessions();
        } catch (error) {
            library?.setError(`Could not start flow: ${this.errorMessage(error)}`);
        }
    }

    private runAction(action: ActionDefinition): void {
        const library = this.productView instanceof FlowLibrary ? this.productView : null;
        library?.setPending(true);
        const run = this.deps.onRunAction
            ? this.deps.onRunAction(this.selectedOwnerState, action)
            : Promise.reject(new Error("Action runner unavailable"));
        void run.then(
            () => this.showSessions(),
            (error: unknown) =>
                library?.setError(`Could not run action: ${this.errorMessage(error)}`),
        );
    }

    private async editLibraryRecord(
        tab: LibraryTab,
        record: FlowDefinition | ActionDefinition | null,
    ): Promise<void> {
        if (!this.deps.onEditRecord) return;
        const kind = tab === "flows" ? "flow" : "action";
        if (!(await this.confirmTerminalEditor(`${kind}.yaml`))) return;
        const library = this.productView instanceof FlowLibrary ? this.productView : null;
        library?.setPending(true);
        try {
            await this.deps.onEditRecord(kind, record, this.selectedOwnerState);
            library?.setPending(false);
        } catch (error) {
            library?.setError(this.errorMessage(error));
        }
    }

    private async deleteLibraryRecord(
        tab: LibraryTab,
        record: FlowDefinition | ActionDefinition,
    ): Promise<void> {
        const confirmed = await this.askProductConfirm("Delete record", `Delete ${record.name}?`);
        if (!confirmed || !this.deps.flowStore) return;
        const library = this.productView instanceof FlowLibrary ? this.productView : null;
        library?.setPending(true);
        try {
            if (tab === "flows") await this.deps.flowStore.deleteFlow(record.id);
            else await this.deps.flowStore.deleteAction(record.id);
        } catch (error) {
            library?.setError(this.errorMessage(error));
        }
    }

    private openFlowRun(): void {
        const store = this.deps.flowStore;
        const run = store?.runFor(this.selectedOwnerState);
        if (!store || !run) {
            this.openFlowLibrary();
            return;
        }
        const flow = store.flows.find((item) => item.id === run.flowId) ?? null;
        const ownerId = flowOwnerId(this.selectedOwnerState);
        const view = new FlowRun({
            renderer: this.deps.renderer,
            run,
            flow,
            actions: store.actions,
            sessionState: (id) => this.sessions.find((session) => session.id === id)?.state,
            pause: () => store.pause(ownerId, run.flowId),
            resume: () => store.resume(ownerId, run.flowId),
            stop: () => store.stop(ownerId, run.flowId),
            skip: () => store.skip(ownerId, run.flowId),
            jump: (index) => store.jump(ownerId, run.flowId, index),
            confirm: (message) => this.askProductConfirm("Flow control", message),
            onFocusSession: (id) => this.focusFlowSession(id),
            onLibrary: () => this.openFlowLibrary(),
            onClose: () => this.showSessions(),
            onDismiss: () => {
                store.dismissRun(this.selectedOwnerState);
                this.openFlowLibrary();
            },
            onStateChange: () => this.updateFooter(),
        });
        this.mountProduct(view, "flow-run");
    }

    private focusFlowSession(sessionId: string): void {
        if (!this.deps.onFocusSession?.(sessionId)) return;
        this.showSessions(true);
    }

    private openSchedules(): void {
        const store = this.deps.scheduleStore;
        if (!store) return;
        const view = new Schedules({
            renderer: this.deps.renderer,
            schedules: store.schedules,
            projects: this.deps.store.projects,
            schedulerEnabled: this.schedulerEnabled,
            onCreate: () => this.editSchedule(null),
            onEdit: (schedule) => this.editSchedule(schedule),
            onDelete: (schedule) => store.delete(schedule.id),
            onToggle: (schedule) =>
                store.update({ id: schedule.id, enabled: !schedule.enabled }).then(() => undefined),
            onTrigger: (schedule) => store.trigger(schedule.id),
            confirm: (message) => this.askProductConfirm("Schedule", message),
            onClose: () => this.showSessions(),
            onStateChange: () => this.updateFooter(),
        });
        this.mountProduct(view, "schedules");
    }

    private async editSchedule(schedule: Schedule | null): Promise<void> {
        if (!this.deps.onEditRecord) return;
        if (!(await this.confirmTerminalEditor("schedule.yaml"))) return;
        await this.deps.onEditRecord("schedule", schedule, this.selectedOwnerState);
    }

    private async confirmTerminalEditor(filename: string): Promise<boolean> {
        const editor = this.deps.settingsStore?.terminalEditor();
        if (this.deps.settingsStore && !editor) {
            await this.askProductConfirm(
                "Terminal editor unavailable",
                "Taskflow could not find a terminal editor. Install Neovim, Nano, Vim, Vi, or another terminal editor, then try again.",
            );
            return false;
        }
        return this.askProductConfirm(
            "Open terminal editor",
            `Taskflow will pause and open ${filename} in ${editor?.name ?? "your terminal editor"}. Save and close the editor to return to Taskflow.`,
        );
    }

    private askProductConfirm(title: string, message: string): Promise<boolean> {
        if (this.productConfirm) return Promise.resolve(false);
        return new Promise<boolean>((resolve) => {
            const close = (value: boolean): void => {
                if (this.productConfirm?.view !== view) return;
                this.productConfirm = null;
                view.destroy();
                resolve(value);
                this.updateFooter();
                this.deps.renderer.requestRender();
            };
            const view = new Confirm({
                renderer: this.deps.renderer,
                title,
                message,
                onCancel: () => close(false),
                onConfirm: () => close(true),
                onStateChange: () => this.updateFooter(),
            });
            this.productConfirm = { view, resolve };
            this.root.add(view.renderable);
            this.deps.renderer.requestRender();
        });
    }

    private syncProductView(): void {
        const flowStore = this.deps.flowStore;
        if (this.productView instanceof TaskDetail) {
            if (this.selectedOwnerState.kind !== "task") {
                this.showSessions();
                return;
            }
            const task = this.deps.store.taskById(this.selectedOwnerState.taskId);
            if (!task || task.status !== "active") {
                this.showSessions();
                return;
            }
            this.productView.update(
                task,
                this.deps.store.projectById(task.projectId),
                resolvedTaskAttributes(task, this.deps.store),
                this.deps.taskStore?.logsFor(task.id) ?? [],
            );
        } else if (this.productView instanceof GitChanges) {
            const path = repositoryPathForOwner(this.selectedOwnerState, this.deps.store);
            if (!path || !this.deps.gitStore) {
                this.showSessions();
                return;
            }
            if (this.deps.gitStore.path !== path) {
                this.openGitChanges();
                return;
            }
            this.productView.update(this.deps.gitStore.status, this.deps.gitStore.diff);
        } else if (this.productView instanceof Settings) {
            this.productView.update(
                this.deps.settingsStore?.settings ?? null,
                this.deps.settingsStore?.choices ?? {
                    agents: [],
                    runtimes: [],
                    shells: [],
                    editors: [],
                    models: { codex: [], opencode: [], pi: [], kimi: [] },
                    systemInfo: null,
                },
                this.deps.store.projects,
            );
        } else if (this.productView instanceof Notifications) {
            this.productView.update(this.deps.notificationStore?.notifications ?? []);
        } else if (this.productView instanceof FlowLibrary && flowStore) {
            this.productView.update(
                visibleDefinitions(flowStore.flows, this.selectedOwnerState),
                visibleDefinitions(flowStore.actions, this.selectedOwnerState),
            );
        } else if (this.productView instanceof FlowRun && flowStore) {
            const run = flowStore.runFor(this.selectedOwnerState);
            if (run) this.productView.update(run);
            else this.openFlowLibrary();
        } else if (this.productView instanceof Schedules && this.deps.scheduleStore) {
            this.productView.update(this.deps.scheduleStore.schedules);
        }

        this.focusPendingFlowSession();
        this.deps.renderer.requestRender();
    }

    private focusPendingFlowSession(): void {
        const run = this.deps.flowStore?.runFor(this.selectedOwnerState);
        const current = run?.actions[run.currentActionIndex];
        if (
            this.pendingFlowOwnerKey === ownerKey(this.selectedOwnerState) &&
            current?.status === "running" &&
            current.sessionId &&
            this.deps.onFocusSession?.(current.sessionId)
        ) {
            this.pendingFlowOwnerKey = null;
            this.showSessions(true);
        }
    }

    private openSessionPicker(): void {
        if (this.picker || this.confirm) return;
        const owner = this.selectedOwnerState;
        const view = new SessionPicker({
            renderer: this.deps.renderer,
            onCancel: () => this.closeSessionPicker(view),
            onSubmit: (item) => this.submitSessionPicker(view, owner, item),
            onStateChange: () => this.updateFooter(),
        });
        this.picker = { view, owner };
        this.root.add(view.renderable);
        this.deps.renderer.requestRender();
        void Promise.all([
            this.deps.net.request<AgentListResponse>(MSG.AGENTS_LIST),
            this.deps.net.request<ShellListResponse>(MSG.SHELLS_LIST),
            this.deps.net.request<AppSettings>(MSG.SETTINGS_GET),
        ]).then(
            ([agents, shells, settings]) => {
                if (this.picker?.view !== view) return;
                view.setItems(buildSessionPickerItems(agents, shells, settings));
                this.deps.renderer.requestRender();
            },
            (error: unknown) => {
                if (this.picker?.view !== view) return;
                view.setError(`Could not load session choices: ${this.errorMessage(error)}`);
                this.deps.renderer.requestRender();
            },
        );
    }

    private submitSessionPicker(
        view: SessionPicker,
        owner: SessionOwner,
        item: SessionPickerItem,
    ): void {
        if (this.picker?.view !== view) return;
        view.setPending(true);
        const { cols, rows } = this.paneDimensions;
        const payload = buildSessionCreatePayload({
            owner,
            item,
            cols,
            rows,
        });
        const create = this.deps.onCreate
            ? this.deps.onCreate(owner, payload)
            : this.deps.net
                  .request<SessionCreateResponse>(MSG.SESSION_CREATE, payload)
                  .then((response) => response.sessionId);
        void create.then(
            () => this.closeSessionPicker(view),
            (error: unknown) => {
                if (this.picker?.view !== view) return;
                view.setError(`Could not start session: ${this.errorMessage(error)}`);
                this.deps.renderer.requestRender();
            },
        );
    }

    private closeSessionPicker(view: SessionPicker): void {
        if (this.picker?.view !== view) return;
        this.picker = null;
        view.destroy();
        this.updateFooter();
        this.deps.renderer.requestRender();
    }

    private errorMessage(error: unknown): string {
        return cleanLabel(error instanceof Error ? error.message : String(error));
    }

    private openCloseConfirm(): void {
        if (this.confirm || this.picker) return;
        const session = this.sessions[this.activeSession];
        if (!session) return;
        const view = new Confirm({
            renderer: this.deps.renderer,
            title: "Close session",
            message: "Closing terminates the process and removes its saved transcript.",
            onCancel: () => this.closeConfirm(view),
            onConfirm: () => this.submitClose(view, session.id),
            onStateChange: () => this.updateFooter(),
        });
        this.confirm = {
            view,
            sessionId: session.id,
            ownerKey: ownerKey(this.selectedOwnerState),
        };
        this.root.add(view.renderable);
        this.deps.renderer.requestRender();
    }

    private submitClose(view: Confirm, sessionId: string): void {
        if (this.confirm?.view !== view) return;
        const close = this.deps.onClose
            ? this.deps.onClose(sessionId)
            : this.deps.net.request(MSG.SESSION_CLOSE, { sessionId }).then(() => undefined);
        void close.catch((error: unknown) => {
            if (this.confirm?.view !== view) return;
            view.setError(`Could not close session: ${this.errorMessage(error)}`);
            this.deps.renderer.requestRender();
        });
    }

    private closeConfirm(view: Confirm): void {
        if (this.confirm?.view !== view) return;
        this.confirm = null;
        view.destroy();
        this.updateFooter();
        this.deps.renderer.requestRender();
    }

    private resumeActiveSession(): void {
        const session = this.sessions[this.activeSession];
        if (!session || !this.canResume(session) || this.resumePending.has(session.id)) return;
        this.resumePending.add(session.id);
        this.resumeErrors.delete(session.id);
        this.updateStatusNotice();
        const { cols, rows } = this.paneDimensions;
        const resume = this.deps.onResume
            ? this.deps.onResume(session.id, cols, rows)
            : this.deps.net
                  .request<SessionResumeResponse>(MSG.SESSION_RESUME, {
                      sessionId: session.id,
                      cols,
                      rows,
                  })
                  .then(() => undefined);
        void resume.catch((error: unknown) => {
            this.resumePending.delete(session.id);
            this.resumeErrors.set(session.id, this.errorMessage(error));
            this.updateStatusNotice();
            this.deps.renderer.requestRender();
        });
    }

    private canResume(session: InjectedSession): boolean {
        return (
            session.state === "interrupted" &&
            session.type !== undefined &&
            session.type !== "shell" &&
            session.type !== "editor" &&
            Boolean(session.nativeSessionId)
        );
    }

    private updateStatusNotice(): void {
        const session = this.sessions[this.activeSession];
        if (!session || (session.state !== "interrupted" && session.state !== "resuming")) {
            this.statusNotice.visible = false;
            this.statusNotice.content = "";
            this.updateFooter();
            return;
        }
        let text: string;
        if (session.state === "resuming" || this.resumePending.has(session.id)) {
            text = " Resuming session... q closes it.";
        } else if (this.canResume(session)) {
            text = " Interrupted. Press r to resume or q to close.";
        } else if (session.type === "shell") {
            text = " Interrupted shell sessions cannot be resumed. Press q to close.";
        } else if (!session.nativeSessionId) {
            text = " Resume unavailable: no native conversation ID. Press q to close.";
        } else {
            text = " Resume unavailable for this session. Press q to close.";
        }
        const error = this.resumeErrors.get(session.id);
        this.statusNotice.content = error
            ? ` Resume failed: ${error}. Press r to retry or q to close.`
            : text;
        this.statusNotice.visible = true;
        this.updateFooter();
    }

    private activeBridge(): SessionBridgeLike | undefined {
        return this.sessions[this.activeSession]?.bridge;
    }

    private currentKeyHints(): string {
        if (this.productConfirm) return this.productConfirm.view.keyHints;
        if (this.confirm) return this.confirm.view.keyHints;
        if (this.picker) return this.picker.view.keyHints;
        if (this.taskCreate) return this.taskCreate.keyHints;
        if (this.gitCommit) return this.gitCommit.keyHints;
        if (this.flowInput) return this.flowInput.keyHints;
        if (this.ownerFilter) return this.ownerFilter.keyHints;
        if (this.help) return this.help.keyHints;
        if (this.mainView !== "sessions" && this.productView) {
            return this.productView.keyHints;
        }
        if (this.focusTarget === "session") {
            return " Ctrl+Esc or Esc Esc  App controls";
        }

        const hints = [
            commandHint("move"),
            commandHint(
                "filter",
                this.ownerFilterValue ? `Filter: ${this.ownerFilterValue}` : undefined,
            ),
        ];
        const session = this.sessions[this.activeSession];
        if (session) hints.push(commandHint("open", "Focus"));
        else if (this.selectedOwnerState.kind === "task") hints.push(commandHint("open", "Detail"));
        if (this.sessions.length > 1) hints.push(commandHint("select-tab"));
        hints.push(commandHint("create"));
        if (this.selectedOwnerState.kind === "task") hints.push(commandHint("task-detail"));
        if (
            this.selectedOwnerState.kind === "project" ||
            (this.selectedOwnerState.kind === "task" &&
                !this.deps.store.taskById(this.selectedOwnerState.taskId)?.parentId)
        ) {
            hints.push(commandHint("task-create"));
        }
        if (session) hints.push(commandHint("close"));
        if (session && this.canResume(session) && !this.resumePending.has(session.id)) {
            hints.push(commandHint("resume"));
        }
        if (this.deps.flowStore) hints.push(commandHint("flows"));
        if (this.deps.scheduleStore) hints.push(commandHint("schedules"));
        if (repositoryPathForOwner(this.selectedOwnerState, this.deps.store)) {
            hints.push(commandHint("git"));
        }
        if (this.deps.settingsStore) hints.push(commandHint("settings"));
        if (this.deps.notificationStore) {
            const unread = this.deps.notificationStore.unreadCount;
            hints.push(
                commandHint(
                    "notifications",
                    `Notifications${unread > 0 ? ` (${String(unread)})` : ""}`,
                ),
            );
        }
        hints.push(commandHint("zoom"));
        if (this.deps.onQuit) hints.push(commandHint("quit"));
        hints.push(commandHint("help"));
        return ` ${hints.join("  ")}`;
    }

    private updateFooter(): void {
        if (this.destroyed || this.footer.isDestroyed) return;
        this.footer.content = this.currentKeyHints();
    }

    private updateFocus(): void {
        for (const session of this.sessions) session.bridge.blur();
        if (this.focusTarget === "session") this.activeBridge()?.focus();
        else this.deps.renderer.setCursorPosition(0, 0, false);
        this.updateFooter();
    }

    private updateSessionVisibility(): void {
        const { paneWidth, paneHeight } = this.paneSize();
        for (const [index, session] of this.sessions.entries()) {
            session.bridge.setActive(
                this.help === null && this.mainView === "sessions" && index === this.activeSession,
                paneWidth,
                paneHeight,
            );
        }
        this.updateFocus();
    }

    private paneSize(): { paneWidth: number; paneHeight: number } {
        const sidebarWidth = this.zoomed
            ? 0
            : Math.min(this.sidebarColumns, Math.floor(this.deps.renderer.terminalWidth / 3));
        return {
            paneWidth: Math.max(1, this.deps.renderer.terminalWidth - sidebarWidth - 2),
            paneHeight: Math.max(1, this.deps.renderer.terminalHeight - 4),
        };
    }

    private applyLayout(): void {
        const sidebarWidth = this.zoomed
            ? 0
            : Math.min(this.sidebarColumns, Math.floor(this.deps.renderer.terminalWidth / 3));
        this.sidebar.width = sidebarWidth;
        this.sidebar.visible = sidebarWidth > 0;
        this.keepSelectionVisible();
        this.updateSessionVisibility();
        this.deps.renderer.requestRender();
    }

    private keepSelectionVisible(): void {
        const height = Math.max(1, this.deps.renderer.terminalHeight - 3);
        const maxStart = Math.max(0, this.rows.length - height);
        const start = Math.min(maxStart, Math.max(0, this.selected - height + 1));
        this.sidebarRowsBox.translateY = -start;
    }

    get focus(): FocusTarget {
        return this.focusTarget;
    }

    get selectedIndex(): number {
        return this.selected;
    }

    get selectedOwner(): SessionOwner {
        return this.selectedOwnerState;
    }

    get selectedSessions(): readonly SessionRef[] {
        return sessionsForOwner(this.deps.store, this.selectedOwnerState);
    }

    setSessions(sessions: readonly InjectedSession[], activeId: string | null = null): void {
        if (this.destroyed) return;
        const previous = this.sessions;
        const previousActiveId = previous[this.activeSession]?.id ?? null;
        const previousActiveIndex = this.activeSession;
        const nextIds = new Set(sessions.map((session) => session.id));
        for (const session of previous) {
            if (!nextIds.has(session.id) && session.bridge.renderable.parent === this.pane) {
                this.pane.remove(session.bridge.renderable);
            }
        }
        if (this.emptyState.parent === this.pane) this.pane.remove(this.emptyState);
        this.sessions = [...sessions];
        for (const session of this.sessions) {
            if (session.state !== "resuming") this.resumePending.delete(session.id);
            if (session.state === "live" || session.state === undefined) {
                this.resumeErrors.delete(session.id);
            }
        }
        const confirm = this.confirm;
        if (confirm && !this.sessions.some((session) => session.id === confirm.sessionId)) {
            this.closeConfirm(confirm.view);
        }
        for (const session of this.sessions) {
            if (session.bridge.renderable.parent !== this.pane)
                this.pane.add(session.bridge.renderable);
        }
        if (this.sessions.length === 0) {
            this.activeSession = 0;
            this.focusTarget = "ui";
            this.pane.add(this.emptyState);
        } else {
            const requested = activeId ?? previousActiveId;
            const requestedIndex = requested
                ? this.sessions.findIndex((session) => session.id === requested)
                : -1;
            this.activeSession =
                requestedIndex >= 0
                    ? requestedIndex
                    : Math.min(previousActiveIndex, this.sessions.length - 1);
        }
        this.rebuildTabs();
        this.updateSessionVisibility();
        this.updateStatusNotice();
        this.deps.renderer.requestRender();
    }

    get isZoomed(): boolean {
        return this.zoomed;
    }

    get paneDimensions(): { cols: number; rows: number } {
        const { paneWidth, paneHeight } = this.paneSize();
        return { cols: paneWidth, rows: paneHeight };
    }

    blurForEditor(): void {
        for (const session of this.sessions) session.bridge.blur();
        this.deps.renderer.setCursorPosition(0, 0, false);
    }

    restoreAfterEditor(): void {
        this.updateFocus();
        this.deps.renderer.requestRender();
    }

    destroy(): void {
        if (this.destroyed) return;
        this.destroyed = true;
        if (this.escapeTimer !== null) clearTimeout(this.escapeTimer);
        this.keyRouter.clear();
        this.picker?.view.destroy();
        this.picker = null;
        this.taskCreate?.destroy();
        this.taskCreate = null;
        this.gitCommit?.destroy();
        this.gitCommit = null;
        this.confirm?.view.destroy();
        this.confirm = null;
        this.flowInput?.destroy();
        this.flowInput = null;
        this.ownerFilter?.destroy();
        this.ownerFilter = null;
        this.help?.destroy();
        this.help = null;
        this.helpPreviousFocus = null;
        this.productView?.destroy();
        this.productView = null;
        if (this.productConfirm) {
            const pending = this.productConfirm;
            this.productConfirm = null;
            pending.view.destroy();
            pending.resolve(false);
        }
        for (const dispose of this.disposers) dispose();
        this.disposers.length = 0;
        for (const session of this.sessions) session.bridge.destroy();
        if (!this.emptyState.isDestroyed) this.emptyState.destroy();
        if (!this.statusNotice.isDestroyed) this.statusNotice.destroy();
        this.root.destroy();
    }
}

export { OpenTuiApp, buildRows, cleanLabel };
export type { InjectedSession, OpenTuiAppDeps, SessionBridgeLike, StoreLike };
