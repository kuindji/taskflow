import { MSG } from "@taskflow/shared";
import type { SystemClientsEvent } from "@taskflow/shared";
import type { Screen } from "../render/screen";
import { ATTR_INVERSE, blankCell } from "../render/cells";
import type { Store } from "../state/store";
import type { NetLike } from "../net/client";
import type { KeyEvent } from "../input/keys";
import type { MouseReport } from "../input/mouse";
import type { InputEvent } from "../input/decode-legacy";
import { encodeForChild, encodeMouseForChild } from "../input/encode";
import type { SessionTerminal } from "../term/session-terminal";
import { buildRows, drawSidebar, type SidebarRow } from "./sidebar";
import { drawTabs, drawSessionPane, type TabSpec } from "./session-pane";
import { route, routeMouse, type Focus } from "./routing";
import { computeLayout, insidePane } from "./layout";
import type { Layout } from "./layout";

/**
 * Pull `index` inside a list of `length`, and onto 0 when the list is empty —
 * `length - 1` is -1 there, which the outer `Math.max` takes back to 0.
 */
function clampIndex(index: number, length: number): number {
    return Math.max(0, Math.min(index, length - 1));
}

interface AppDeps {
    net: NetLike;
    store: Store;
    screen: Screen;
    cols: number;
    rows: number;
    kittyAvailable: boolean;
}

interface OpenSession {
    id: string;
    term: SessionTerminal;
}

class App {
    private selected = 0;
    private focusTarget: Focus = "sidebar";
    private pendingEscape = false;
    private zoomed = false;
    private alive = true;
    private sidebarRows: SidebarRow[] = [];
    private readonly sessions: OpenSession[] = [];
    private activeSession = 0;
    /** Clients other than this one attached to the same backend. */
    private otherClients = 0;

    constructor(private readonly deps: AppDeps) {}

    async init(): Promise<void> {
        // A reconnect resumes the broadcast stream but replays nothing that was
        // missed, so every project and task change made while the socket was
        // down is simply absent from the store. Take the snapshot again, or the
        // sidebar keeps showing whatever the outage froze it at.
        // Subscribed before the first load, but that load is not doubled: the
        // socket is already open by the time init() runs, so the client emits no
        // further `connected: true` until an outage has actually happened.
        this.deps.net.onStatusChange(({ connected }) => {
            if (!connected) return;
            // The store has no error channel: a reload that fails leaves the
            // stale rows in place, and the next reconnect tries again.
            void this.deps.store.load().catch(() => undefined);
            // The backend keeps the PTY alive across a dropped connection, so a
            // reconnect only has to re-fetch each session's current screen —
            // the local xterm still holds whatever was on it before the drop,
            // and everything the child wrote during the outage is missing from
            // it. An attach that fails leaves that stale screen up, which is
            // the same position a failed reload leaves the sidebar in.
            for (const session of this.sessions) {
                void session.term.attach().catch(() => undefined);
            }
        });
        // A session has one grid on the backend and the last resize wins, so a
        // second client attached at a different size makes one of the two
        // render wrongly. The count is broadcast rather than asked for, and it
        // includes this client — hence the -1.
        this.deps.net.on(MSG.SYSTEM_CLIENTS, (payload) => {
            const event = payload as SystemClientsEvent;
            this.otherClients = Math.max(0, event.count - 1);
        });
        await this.deps.store.load();
        this.setRows(buildRows(this.deps.store));
    }

    /**
     * Adopt a freshly built row list, pulling the selection back inside it. The
     * list shrinks under the cursor whenever a broadcast removes or archives a
     * record, and `drawSidebar` will not highlight a row that is no longer
     * there — so without this the sidebar simply loses its selection until the
     * next movement key.
     */
    private setRows(rows: SidebarRow[]): void {
        this.sidebarRows = rows;
        this.selected = clampIndex(this.selected, rows.length);
    }

    /**
     * The one place the selection moves. A click names an absolute row and a
     * key names a delta, but both land here, so the two can never disagree
     * about where the list ends.
     */
    private selectRow(index: number): void {
        this.selected = clampIndex(index, this.sidebarRows.length);
    }

    /**
     * Make tab `index` the active one, or do nothing if there is no such tab.
     * Shared by the number keys and by a click on the strip for the same reason
     * as `selectRow`. Reports whether it applied, because a click that missed
     * must not move focus into a pane that did not change.
     */
    private selectTab(index: number): boolean {
        if (index < 0 || index >= this.sessions.length) return false;
        this.activeSession = index;
        return true;
    }

    /**
     * The tab strip as it is drawn. Hit-testing goes through the same list as
     * `render`, so a click is tested against the labels that were painted
     * rather than against a second guess at them.
     */
    private tabSpecs(): TabSpec[] {
        return this.sessions.map((_, i) => ({
            label: `session ${String(i + 1)}`,
            active: i === this.activeSession,
        }));
    }

    get focus(): Focus {
        return this.focusTarget;
    }

    get running(): boolean {
        return this.alive;
    }

    handleKey(ev: KeyEvent): void {
        const result = route(this.focusTarget, ev, this.deps.kittyAvailable, this.pendingEscape);
        this.pendingEscape = result.pendingEscape;
        const action = result.action;

        switch (action.kind) {
            case "toggle-focus":
                this.focusTarget = this.focusTarget === "sidebar" ? "session" : "sidebar";
                return;
            case "move":
                this.selectRow(this.selected + action.delta);
                return;
            case "select-tab":
                this.selectTab(action.index);
                return;
            case "zoom":
                this.zoomed = !this.zoomed;
                return;
            case "quit":
                this.alive = false;
                return;
            case "to-child":
                this.sendToChild(action.events);
                return;
            default:
                return;
        }
    }

    /**
     * A decoded mouse report, hit-tested against the layout the frame was drawn
     * with and applied to the same state the keymap moves.
     *
     * The layout is recomputed rather than remembered from `render`: `cols` and
     * `rows` are owned here and free to read, and a cached rectangle would be
     * one frame stale after a resize — long enough for a click to land in the
     * wrong pane.
     *
     * A report never touches `pendingEscape`. In legacy mode a bare Escape is
     * held for 25ms waiting for its pair, so a click inside that window reaches
     * the child ahead of the Escape it followed. That is left alone: the window
     * is 25ms, no binding can observe the reordering, and draining the carry
     * from here would put escape timing in two places.
     */
    handleMouse(report: MouseReport): void {
        const { cols, rows } = this.deps;
        const layout = computeLayout(cols, rows, this.zoomed);

        // Ahead of routeMouse: a child that asked for the mouse owns every
        // report inside its own pane, so the UI's wheel and click bindings must
        // not shadow the ones it is waiting for.
        const session = this.sessions[this.activeSession];
        if (
            session !== undefined &&
            insidePane(report.col, report.row, layout) &&
            session.term.modes.mouseTracking !== "none"
        ) {
            this.focusTarget = "session";
            // insidePane put the report inside the rect, so both are already
            // non-negative.
            const col = report.col - layout.paneX;
            const row = report.row - layout.paneY;
            const { terminal } = session.term;
            // Past the child's own grid is not a click on its last cell: the
            // pane can outrun the child for a frame after a resize, which
            // blitTerminal guards against the same way.
            if (col < terminal.cols && row < terminal.rows) {
                this.sendToChild([{ ...report, col, row }]);
            }
            return;
        }

        const action = routeMouse(report, layout, {
            rows: this.sidebarRows.length,
            tabs: this.tabSpecs(),
        });

        switch (action.kind) {
            case "select":
                this.selectRow(action.index);
                this.focusTarget = "sidebar";
                return;
            case "move":
                this.selectRow(this.selected + action.delta);
                return;
            case "open-tab":
                if (this.selectTab(action.index)) this.focusTarget = "session";
                return;
            case "focus":
                this.focusTarget = action.target;
                return;
            case "scroll":
                // Nothing is open in Stage 1, and a wheel notch over an empty
                // pane has nothing to move rather than something to report.
                this.sessions[this.activeSession]?.term.scroll(action.delta);
                return;
            default:
                return;
        }
    }

    /**
     * Input bound for the focused child, encoded against that child's own
     * terminal modes — so an arrow key reaches an application-cursor-keys child
     * as `SS3 A` and everything else as `CSI A`, and a mouse report is spelled
     * in whichever tracking and encoding modes the child actually asked for.
     */
    private sendToChild(events: InputEvent[]): void {
        const session = this.sessions[this.activeSession];
        if (!session) return;
        const { modes } = session.term;
        let data = "";
        for (const event of events) {
            data +=
                event.kind === "mouse"
                    ? encodeMouseForChild(event, modes)
                    : encodeForChild(event, modes);
        }
        if (data === "") return;
        // A dropped keystroke is not worth tearing the app down for, and the
        // socket reports the disconnect on its own status channel.
        void this.deps.net
            .request(MSG.SESSION_INPUT, { sessionId: session.id, data })
            .catch(() => undefined);
    }

    /**
     * Overlay the "someone else is attached" banner on the right of the tab
     * strip. Drawn over the tabs rather than beside them because the strip is
     * the only row that is always present, and the warning matters more than
     * the tail of a tab label.
     */
    private drawClientWarning(layout: Layout): void {
        if (this.otherClients === 0) return;
        const warning = ` ${String(this.otherClients)} other client(s) attached `;
        const startX = Math.max(layout.paneX, layout.cols - warning.length);
        for (let i = 0; i < warning.length; i++) {
            this.deps.screen.back.set(startX + i, layout.tabRow, {
                ...blankCell(),
                ch: warning[i] ?? " ",
                attrs: ATTR_INVERSE,
            });
        }
    }

    render(): void {
        const { screen, cols, rows } = this.deps;
        // Rebuilt every frame: the store mutates in place on broadcasts, and the
        // rows are cheap enough that tracking dirtiness would cost more than it saves.
        this.setRows(buildRows(this.deps.store));

        const layout = computeLayout(cols, rows, this.zoomed);
        if (layout.sidebarWidth > 0) {
            drawSidebar(screen.back, this.sidebarRows, this.selected, layout.sidebarWidth, rows);
        }

        drawTabs(screen.back, layout.paneX, layout.tabRow, layout.paneWidth, this.tabSpecs());
        this.drawClientWarning(layout);

        const active = this.sessions[this.activeSession];
        const cursor = drawSessionPane(screen.back, active?.term ?? null, {
            x: layout.paneX,
            y: layout.paneY,
            width: layout.paneWidth,
            height: layout.paneHeight,
        });

        // The real cursor belongs to the child, so it is only shown while the
        // child has focus; the sidebar draws its selection with inverse video.
        screen.setCursor(this.focusTarget === "session" ? cursor : null);
        screen.flush();
    }
}

export { App };
