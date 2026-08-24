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
import type { Project, SystemClientsEvent, Task } from "@taskflow/shared";
import type { NetLike } from "../net/client";
import type { SessionBridge } from "./session-bridge";
import { KeyRouter, prepareForEmbeddedTerminal, type FocusTarget, type UiCommand } from "./keys";

interface StoreLike {
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
    bridge: SessionBridgeLike;
}

interface OpenTuiAppDeps {
    renderer: CliRenderer;
    net: NetLike;
    store: StoreLike;
    sessions?: InjectedSession[];
    onQuit?: () => void;
}

interface SidebarRow {
    kind: "project" | "task";
    id: string;
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
    const rows: SidebarRow[] = [];
    for (const project of store.projects) {
        rows.push({
            kind: "project",
            id: project.id,
            label: cleanLabel(project.name),
            sessionCount: project.sessions.length,
        });
        for (const task of store.tasksFor(project.id)) {
            rows.push({
                kind: "task",
                id: task.id,
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
    private readonly sessions: InjectedSession[];
    private readonly keyRouter = new KeyRouter();
    private readonly disposers: Array<() => void> = [];
    private rows: SidebarRow[] = [];
    private rowsSignature = "";
    private selected = 0;
    private activeSession = 0;
    private focusTarget: FocusTarget = "ui";
    private zoomed = false;
    private otherClients = 0;
    private clientsBroadcast = false;
    private escapeTimer: ReturnType<typeof setTimeout> | null = null;
    private destroyed = false;

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

        this.sidebar.add(this.sidebarRowsBox);
        this.main.add(this.tabStrip);
        this.main.add(this.pane);
        this.root.add(this.sidebar);
        this.root.add(this.main);
        deps.renderer.root.add(this.root);
        for (const session of this.sessions) this.pane.add(session.bridge.renderable);

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
                for (const session of this.sessions)
                    void session.bridge.attach().catch(() => undefined);
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
        if (!force && signature === this.rowsSignature) return;
        this.rows = rows;
        this.rowsSignature = signature;
        this.selected = Math.max(0, Math.min(this.selected, rows.length - 1));
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
                (row.kind === "project" ? TextAttributes.BOLD : 0) |
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
                    content: ` ${cleanLabel(session.label)} `,
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
        this.focusTarget = "ui";
        if (changed) this.rebuildSidebar();
        this.updateFocus();
        this.deps.renderer.requestRender();
    }

    private selectSession(index: number, event?: MouseEvent): void {
        if (index < 0 || index >= this.sessions.length) return;
        event?.preventDefault();
        event?.stopPropagation();
        if (index === this.activeSession && this.focusTarget === "session") return;
        this.activeSession = index;
        this.focusTarget = "session";
        this.rebuildTabs();
        this.updateSessionVisibility();
        this.updateFocus();
        this.deps.renderer.requestRender();
    }

    private handleKey(event: KeyEvent): void {
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
                this.rebuildSidebar();
                break;
            case "select-tab":
                if (command.index >= this.sessions.length) return;
                this.activeSession = command.index;
                this.rebuildTabs();
                this.updateSessionVisibility();
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

    get isZoomed(): boolean {
        return this.zoomed;
    }

    destroy(): void {
        if (this.destroyed) return;
        this.destroyed = true;
        if (this.escapeTimer !== null) clearTimeout(this.escapeTimer);
        this.keyRouter.clear();
        for (const dispose of this.disposers) dispose();
        this.disposers.length = 0;
        for (const session of this.sessions) session.bridge.destroy();
        this.root.destroy();
    }
}

export { OpenTuiApp, buildRows, cleanLabel };
export type { InjectedSession, OpenTuiAppDeps, SessionBridgeLike, StoreLike };
