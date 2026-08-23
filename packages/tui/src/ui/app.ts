import { MSG } from "@taskflow/shared";
import type { Screen } from "../render/screen";
import type { Store } from "../state/store";
import type { NetLike } from "../net/client";
import type { KeyEvent } from "../input/keys";
import { encodeForChild } from "../input/encode";
import type { SessionTerminal } from "../term/session-terminal";
import { buildRows, drawSidebar, type SidebarRow } from "./sidebar";
import { drawTabs, drawSessionPane, type TabSpec } from "./session-pane";
import { route, type Focus } from "./routing";
import { computeLayout } from "./layout";

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

    constructor(private readonly deps: AppDeps) {}

    async init(): Promise<void> {
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
        this.selected = Math.max(0, Math.min(this.selected, rows.length - 1));
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
                this.selected = Math.max(
                    0,
                    Math.min(this.sidebarRows.length - 1, this.selected + action.delta),
                );
                return;
            case "select-tab":
                if (action.index < this.sessions.length) this.activeSession = action.index;
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
     * Keys bound for the focused child are encoded against that child's own
     * terminal modes, so an arrow key reaches an application-cursor-keys child
     * as `SS3 A` and everything else as `CSI A`.
     */
    private sendToChild(events: KeyEvent[]): void {
        const session = this.sessions[this.activeSession];
        if (!session) return;
        let data = "";
        for (const event of events) data += encodeForChild(event, session.term.modes);
        if (data === "") return;
        // A dropped keystroke is not worth tearing the app down for, and the
        // socket reports the disconnect on its own status channel.
        void this.deps.net
            .request(MSG.SESSION_INPUT, { sessionId: session.id, data })
            .catch(() => undefined);
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

        const tabs: TabSpec[] = this.sessions.map((_, i) => ({
            label: `session ${String(i + 1)}`,
            active: i === this.activeSession,
        }));
        drawTabs(screen.back, layout.paneX, layout.tabRow, layout.paneWidth, tabs);

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
