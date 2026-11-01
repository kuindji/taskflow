import {
    ScrollBoxRenderable,
    TextRenderable,
    type CliRenderer,
    type KeyEvent,
} from "@opentui/core";
import type { ActionDefinition, FlowDefinition, FlowRun as FlowRunRecord } from "@taskflow/shared";
import { actionLabel, latestArtifactsByType } from "../flows/model";
import { followSelection } from "./follow-selection";
import { SELECTED_TEXT_STYLE } from "./selection-style";

interface FlowRunDeps {
    renderer: CliRenderer;
    run: FlowRunRecord;
    flow: FlowDefinition | null;
    actions: readonly ActionDefinition[];
    sessionState(sessionId: string): "live" | "interrupted" | "resuming" | undefined;
    pause(): Promise<void>;
    resume(): Promise<void>;
    stop(): Promise<void>;
    skip(): Promise<void>;
    jump(index: number): Promise<void>;
    confirm(message: string): Promise<boolean>;
    onFocusSession(sessionId: string): void;
    onLibrary(): void;
    onClose(): void;
    onDismiss(): void;
    onStateChange?(): void;
}

class FlowRun {
    readonly renderable: ScrollBoxRenderable;
    private readonly revealSelection: () => void;
    private run: FlowRunRecord;
    private selected = 0;
    private pending = false;
    private error: string | null = null;

    constructor(private readonly deps: FlowRunDeps) {
        this.run = deps.run;
        this.renderable = new ScrollBoxRenderable(deps.renderer, {
            id: "flow-run",
            width: "100%",
            height: "100%",
            scrollY: true,
            scrollX: false,
            onMouseScroll: (event) => {
                const direction = event.scroll?.direction;
                if (direction !== "up" && direction !== "down") return;
                event.preventDefault();
                event.stopPropagation();
                this.move(direction === "up" ? -1 : 1);
            },
        });
        this.revealSelection = followSelection(this.renderable, "flow-run-selected");
        this.rebuild();
    }

    get flowId(): string {
        return this.run.flowId;
    }

    get keyHints(): string {
        if (this.pending) return " Working...";
        const hints = ["↑↓ Move"];
        const selected = this.run.actions[this.selected];
        if (selected?.sessionId) hints.push("Enter Terminal");
        const stopHint = this.run.loop ? "x Finish" : "x Stop";
        if (this.run.status === "running") hints.push("p Pause", "s Skip", stopHint);
        else if (this.run.status === "paused") hints.push("p Resume", stopHint);
        if (selected?.status === "completed" || selected?.status === "failed") {
            hints.push("R Restart");
        }
        if (this.run.status === "completed" || this.run.status === "failed") {
            hints.push("d Dismiss");
        }
        hints.push("l Library", "q Sessions");
        return ` ${hints.join("  ")}`;
    }

    update(run: FlowRunRecord): void {
        const selectedId = this.run.actions[this.selected]?.actionEntryId;
        const previous = this.selected;
        this.run = run;
        const retained = selectedId
            ? run.actions.findIndex((action) => action.actionEntryId === selectedId)
            : -1;
        this.selected =
            retained >= 0 ? retained : Math.min(previous, Math.max(0, run.actions.length - 1));
        this.pending = false;
        this.rebuild();
    }

    handleKey(event: KeyEvent): void {
        if (event.eventType !== "press" || this.pending) return;
        if (event.name === "escape" || event.sequence === "q") return this.deps.onClose();
        if (event.name === "down" || event.sequence === "j") return this.move(1);
        if (event.name === "up" || event.sequence === "k") return this.move(-1);
        if (event.sequence === "l") return this.deps.onLibrary();
        if (event.name === "return" || event.name === "enter") {
            const sessionId = this.run.actions[this.selected]?.sessionId;
            if (sessionId) this.deps.onFocusSession(sessionId);
            return;
        }
        if (event.sequence === "p") {
            if (this.run.status === "running") void this.runControl(() => this.deps.pause());
            else if (this.run.status === "paused") {
                const current = this.run.actions[this.run.currentActionIndex];
                if (
                    current?.sessionId &&
                    this.deps.sessionState(current.sessionId) === "interrupted"
                ) {
                    this.error = "Resume the interrupted session from its terminal tab.";
                    this.rebuild();
                } else void this.runControl(() => this.deps.resume());
            }
            return;
        }
        if (event.sequence === "s" && this.run.status === "running") {
            void this.runControl(() => this.deps.skip());
            return;
        }
        if (event.sequence === "x" && this.canStop()) {
            void this.runConfirmed(
                this.run.loop ? "Finish this loop?" : "Stop this flow?",
                () => this.canStop(),
                () => this.deps.stop(),
            );
            return;
        }
        if (event.sequence === "R") {
            const index = this.selected;
            if (this.canRestart(index)) {
                void this.runConfirmed(
                    "Restart from this action?",
                    () => this.canRestart(index),
                    () => this.deps.jump(index),
                );
            }
            return;
        }
        if (
            event.sequence === "d" &&
            (this.run.status === "completed" || this.run.status === "failed")
        ) {
            this.deps.onDismiss();
        }
    }

    private async runControl(control: () => Promise<void>): Promise<void> {
        this.pending = true;
        this.error = null;
        this.rebuild();
        try {
            await control();
        } catch (error) {
            this.pending = false;
            this.error = error instanceof Error ? error.message : String(error);
            this.rebuild();
        }
    }

    private canStop(): boolean {
        return this.run.status === "running" || this.run.status === "paused";
    }

    private canRestart(index: number): boolean {
        const action = this.run.actions[index];
        return action?.status === "completed" || action?.status === "failed";
    }

    /**
     * Runs updates keep arriving while the confirmation is open. A control the
     * run no longer allows is dropped: the backend answers it without an
     * update, which would leave the view pending.
     */
    private async runConfirmed(
        message: string,
        allowed: () => boolean,
        control: () => Promise<void>,
    ): Promise<void> {
        if (!(await this.deps.confirm(message)) || !allowed()) return;
        await this.runControl(control);
    }

    private move(delta: number): void {
        if (this.run.actions.length === 0) return;
        this.selected = Math.min(this.run.actions.length - 1, Math.max(0, this.selected + delta));
        this.rebuild();
    }

    private rebuild(): void {
        for (const child of [...this.renderable.getChildren()]) child.destroy();
        this.renderable.add(
            new TextRenderable(this.deps.renderer, {
                content: ` ${this.deps.flow?.name ?? this.run.flowId}  ${this.run.status}${this.run.loop ? `  iteration ${String(this.run.iteration ?? 1)}` : ""}`,
                height: 1,
            }),
        );
        for (const [index, state] of this.run.actions.entries()) {
            const entry = this.deps.flow?.actions.find((item) => item.id === state.actionEntryId);
            const label = entry ? actionLabel(entry, this.deps.actions) : state.actionEntryId;
            this.renderable.add(
                new TextRenderable(this.deps.renderer, {
                    content: ` ${label}  ${state.status}${state.sessionId ? `  ${state.sessionId}` : ""}`,
                    height: 1,
                    ...(index === this.selected
                        ? { id: "flow-run-selected", ...SELECTED_TEXT_STYLE }
                        : {}),
                    onMouseDown: (event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        this.selected = index;
                        this.rebuild();
                    },
                }),
            );
        }
        for (const artifact of latestArtifactsByType(this.run.artifacts)) {
            this.renderable.add(
                new TextRenderable(this.deps.renderer, {
                    content: ` ${artifact.type}: ${artifact.path ?? artifact.text ?? ""}`,
                    height: 1,
                }),
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
        this.revealSelection();
        this.deps.onStateChange?.();
    }

    destroy(): void {
        this.renderable.destroy();
    }
}

export { FlowRun };
export type { FlowRunDeps };
