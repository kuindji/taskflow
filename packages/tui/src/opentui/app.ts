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
    AgentListResponse,
    AppSettings,
    Project,
    SessionCreatePayload,
    SessionCreateResponse,
    SessionRef,
    SessionResumeResponse,
    ShellListResponse,
    SystemClientsEvent,
    Task,
} from "@taskflow/shared";
import type { NetLike } from "../net/client";
import {
    buildSessionCreatePayload,
    buildSessionPickerItems,
    type SessionPickerItem,
} from "../sessions/create-model";
import {
    MASTER_OWNER,
    ownerKey,
    resolveOwner,
    sessionsForOwner,
    type SessionOwner,
} from "../sessions/owner";
import type { SessionBridge } from "./session-bridge";
import { Confirm } from "./confirm";
import { SessionPicker } from "./session-picker";
import { KeyRouter, prepareForEmbeddedTerminal, type FocusTarget, type UiCommand } from "./keys";

interface StoreLike {
    readonly masterSessions: readonly SessionRef[];
    readonly projects: readonly Project[];
    readonly tasks: readonly Task[];
    tasksFor(projectId: string): Task[];
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

function buildRows(store: StoreLike): SidebarRow[] {
    const rows: SidebarRow[] = [
        {
            kind: "master",
            id: "master",
            owner: MASTER_OWNER,
            label: "Master Workspace",
            sessionCount: store.masterSessions.length,
        },
    ];
    for (const project of store.projects) {
        rows.push({
            kind: "project",
            id: project.id,
            owner: { kind: "project", projectId: project.id },
            label: cleanLabel(project.name),
            sessionCount: project.sessions.length,
        });
        for (const task of store.tasksFor(project.id)) {
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
    private readonly sidebar: BoxRenderable;
    private readonly sidebarRowsBox: BoxRenderable;
    private readonly main: BoxRenderable;
    private readonly tabStrip: BoxRenderable;
    private readonly pane: BoxRenderable;
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

    constructor(private readonly deps: OpenTuiAppDeps) {
        this.sessions = deps.sessions ?? [];
        this.root = new BoxRenderable(deps.renderer, {
            id: "taskflow-root",
            width: "100%",
            height: "100%",
            flexDirection: "row",
        });
        this.sidebar = new BoxRenderable(deps.renderer, {
            id: "sidebar",
            height: "100%",
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
            attributes: TextAttributes.INVERSE,
            selectable: false,
            visible: false,
        });

        this.sidebar.add(this.sidebarRowsBox);
        this.main.add(this.tabStrip);
        this.main.add(this.pane);
        this.root.add(this.sidebar);
        this.root.add(this.main);
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
    }

    async init(): Promise<void> {
        this.disposers.push(
            this.deps.store.onChange(() => {
                this.refreshRows();
            }),
        );
        this.disposers.push(
            this.deps.net.onStatusChange(({ connected }) => {
                if (!connected) return;
                void this.deps.store.load().catch(() => undefined);
                if (this.deps.onReconnect) this.deps.onReconnect();
                else {
                    for (const session of this.sessions)
                        void session.bridge.attach().catch(() => undefined);
                }
            }),
        );
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
        await this.deps.store.load();
        await clientCount;
        this.refreshRows(true);
    }

    private refreshRows(force = false): void {
        const rows = buildRows(this.deps.store);
        const signature = rowSignature(rows);
        const previousOwnerKey = ownerKey(this.selectedOwnerState);
        this.selectedOwnerState = resolveOwner(this.deps.store, this.selectedOwnerState);
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
        if (!force && signature === this.rowsSignature && !ownerChanged) return;
        this.rows = rows;
        this.rowsSignature = signature;
        const selectedKey = ownerKey(this.selectedOwnerState);
        const selectedIndex = rows.findIndex((row) => ownerKey(row.owner) === selectedKey);
        this.selected = selectedIndex === -1 ? 0 : selectedIndex;
        this.rebuildSidebar();
        this.deps.renderer.requestRender();
    }

    private clearChildren(parent: BoxRenderable): void {
        for (const child of [...parent.getChildren()]) child.destroy();
    }

    private rebuildSidebar(): void {
        this.clearChildren(this.sidebarRowsBox);
        const selectedAttrs = TextAttributes.INVERSE;
        for (const [index, row] of this.rows.entries()) {
            const attrs =
                (row.kind !== "task" ? TextAttributes.BOLD : 0) |
                (index === this.selected ? selectedAttrs : 0);
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
                    attributes: index === this.activeSession ? TextAttributes.INVERSE : 0,
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
                    attributes: TextAttributes.INVERSE,
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
        if (this.confirm) {
            event.preventDefault();
            event.stopPropagation();
            this.confirm.view.handleKey(event);
            return;
        }
        if (this.picker) {
            event.preventDefault();
            event.stopPropagation();
            this.picker.view.handleKey(event);
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
                if (this.sessions.length === 0) return;
                this.focusTarget = "session";
                this.updateFocus();
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
        this.deps.renderer.requestRender();
    }

    private openSessionPicker(): void {
        if (this.picker || this.confirm) return;
        const owner = this.selectedOwnerState;
        const view = new SessionPicker({
            renderer: this.deps.renderer,
            onCancel: () => this.closeSessionPicker(view),
            onSubmit: (item) => this.submitSessionPicker(view, owner, item),
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
        const taskDescription =
            owner.kind === "task"
                ? this.deps.store.tasks.find((task) => task.id === owner.taskId)?.description
                : undefined;
        const { cols, rows } = this.paneDimensions;
        const payload = buildSessionCreatePayload({
            owner,
            item,
            cols,
            rows,
            taskDescription,
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
    }

    private activeBridge(): SessionBridgeLike | undefined {
        return this.sessions[this.activeSession]?.bridge;
    }

    private updateFocus(): void {
        for (const session of this.sessions) session.bridge.blur();
        if (this.focusTarget === "session") this.activeBridge()?.focus();
        else this.deps.renderer.setCursorPosition(0, 0, false);
    }

    private updateSessionVisibility(): void {
        const { paneWidth, paneHeight } = this.paneSize();
        for (const [index, session] of this.sessions.entries()) {
            session.bridge.setActive(index === this.activeSession, paneWidth, paneHeight);
        }
        this.updateFocus();
    }

    private paneSize(): { paneWidth: number; paneHeight: number } {
        const sidebarWidth = this.zoomed
            ? 0
            : Math.min(30, Math.floor(this.deps.renderer.terminalWidth / 3));
        return {
            paneWidth: Math.max(1, this.deps.renderer.terminalWidth - sidebarWidth),
            paneHeight: Math.max(1, this.deps.renderer.terminalHeight - 1),
        };
    }

    private applyLayout(): void {
        const sidebarWidth = this.zoomed
            ? 0
            : Math.min(30, Math.floor(this.deps.renderer.terminalWidth / 3));
        this.sidebar.width = sidebarWidth;
        this.sidebar.visible = sidebarWidth > 0;
        this.keepSelectionVisible();
        this.updateSessionVisibility();
        this.deps.renderer.requestRender();
    }

    private keepSelectionVisible(): void {
        const height = Math.max(1, this.deps.renderer.terminalHeight);
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

    destroy(): void {
        if (this.destroyed) return;
        this.destroyed = true;
        if (this.escapeTimer !== null) clearTimeout(this.escapeTimer);
        this.keyRouter.clear();
        this.picker?.view.destroy();
        this.picker = null;
        this.confirm?.view.destroy();
        this.confirm = null;
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
