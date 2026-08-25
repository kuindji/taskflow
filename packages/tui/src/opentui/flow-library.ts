import { BoxRenderable, TextRenderable, type CliRenderer, type KeyEvent } from "@opentui/core";
import type { ActionDefinition, FlowDefinition } from "@taskflow/shared";
import { stableSelectionIndex } from "../flows/model";
import { SELECTED_TEXT_STYLE } from "./selection-style";

type LibraryTab = "flows" | "actions";

interface FlowLibraryDeps {
    renderer: CliRenderer;
    flows: readonly FlowDefinition[];
    actions: readonly ActionDefinition[];
    onStartFlow(flow: FlowDefinition): void;
    onRunAction(action: ActionDefinition): void;
    onCreate(tab: LibraryTab): void;
    onEdit(record: FlowDefinition | ActionDefinition, tab: LibraryTab): void;
    onDelete(record: FlowDefinition | ActionDefinition, tab: LibraryTab): void;
    onViewRun(): void;
    onClose(): void;
    onStateChange?(): void;
}

function scopeLabel(projectId?: string): string {
    return projectId ? "project" : "global";
}

class FlowLibrary {
    readonly renderable: BoxRenderable;
    private tab: LibraryTab = "flows";
    private flows: FlowDefinition[];
    private actions: ActionDefinition[];
    private selected = 0;
    private pending = false;
    private error: string | null = null;

    constructor(private readonly deps: FlowLibraryDeps) {
        this.flows = [...deps.flows];
        this.actions = [...deps.actions];
        this.renderable = new BoxRenderable(deps.renderer, {
            id: "flow-library",
            width: "100%",
            height: "100%",
            flexDirection: "column",
            overflow: "hidden",
            onMouseScroll: (event) => {
                const direction = event.scroll?.direction;
                if (direction !== "up" && direction !== "down") return;
                event.preventDefault();
                event.stopPropagation();
                this.move(direction === "up" ? -1 : 1);
            },
        });
        this.rebuild();
    }

    get activeTab(): LibraryTab {
        return this.tab;
    }

    get selectedId(): string | null {
        return this.items[this.selected]?.id ?? null;
    }

    get keyHints(): string {
        return this.pending
            ? " Working..."
            : " ↑↓ Move  Tab Switch  Enter Run  n New  e Edit  d Delete  v Run  q Sessions";
    }

    private get items(): Array<FlowDefinition | ActionDefinition> {
        return this.tab === "flows" ? this.flows : this.actions;
    }

    update(flows: readonly FlowDefinition[], actions: readonly ActionDefinition[]): void {
        const selectedId = this.selectedId;
        const previousIndex = this.selected;
        this.flows = [...flows];
        this.actions = [...actions];
        this.selected = stableSelectionIndex(this.items, selectedId, previousIndex);
        this.rebuild();
    }

    setPending(pending: boolean): void {
        this.pending = pending;
        this.rebuild();
    }

    setError(error: string | null): void {
        this.pending = false;
        this.error = error;
        this.rebuild();
    }

    handleKey(event: KeyEvent): void {
        if (event.eventType !== "press" || this.pending) return;
        if (event.name === "escape" || event.sequence === "q") return this.deps.onClose();
        if (event.name === "tab") {
            this.tab = this.tab === "flows" ? "actions" : "flows";
            this.selected = stableSelectionIndex(this.items, null, 0);
            this.error = null;
            this.rebuild();
            return;
        }
        if (event.name === "down" || event.sequence === "j") return this.move(1);
        if (event.name === "up" || event.sequence === "k") return this.move(-1);
        if (event.sequence === "v") return this.deps.onViewRun();
        if (event.sequence === "n") return this.deps.onCreate(this.tab);
        const item = this.items[this.selected];
        if (!item) return;
        if (event.sequence === "e") return this.deps.onEdit(item, this.tab);
        if (event.sequence === "d") return this.deps.onDelete(item, this.tab);
        if (event.name === "return" || event.name === "enter") this.activate(item);
    }

    private move(delta: number): void {
        if (this.items.length === 0) return;
        this.selected = Math.min(this.items.length - 1, Math.max(0, this.selected + delta));
        this.rebuild();
    }

    private activate(item: FlowDefinition | ActionDefinition): void {
        if (this.tab === "flows") {
            this.deps.onStartFlow(item as FlowDefinition);
            return;
        }
        const action = item as ActionDefinition;
        if (!action.standalone) {
            this.setError("This action is not marked standalone.");
            return;
        }
        this.deps.onRunAction(action);
    }

    private rebuild(): void {
        for (const child of [...this.renderable.getChildren()]) child.destroy();
        this.renderable.add(
            new TextRenderable(this.deps.renderer, {
                content: ` ${this.tab === "flows" ? "[Flows]  Actions" : "Flows  [Actions]"}`,
                height: 1,
            }),
        );
        for (const [index, item] of this.items.entries()) {
            const standalone =
                this.tab === "actions" && !(item as ActionDefinition).standalone
                    ? "  not standalone"
                    : "";
            this.renderable.add(
                new TextRenderable(this.deps.renderer, {
                    content: ` ${item.name}  ${scopeLabel(item.projectId)}${standalone}`,
                    height: 1,
                    ...(index === this.selected ? SELECTED_TEXT_STYLE : {}),
                    onMouseDown: (event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        this.selected = index;
                        this.rebuild();
                        this.activate(item);
                    },
                }),
            );
        }
        if (this.items.length === 0) {
            this.renderable.add(
                new TextRenderable(this.deps.renderer, { content: " No records.", height: 1 }),
            );
        }
        if (this.error) {
            this.renderable.add(
                new TextRenderable(this.deps.renderer, {
                    content: ` ${this.error}`,
                    height: 1,
                }),
            );
        }
        this.deps.onStateChange?.();
    }

    destroy(): void {
        this.renderable.destroy();
    }
}

export { FlowLibrary };
export type { FlowLibraryDeps, LibraryTab };
