import {
    BoxRenderable,
    TextRenderable,
    type CliRenderer,
    type KeyEvent,
} from "@opentui/core";
import type { Project, Schedule } from "@taskflow/shared";
import { stableSelectionIndex } from "../flows/model";
import { scheduleStatusText } from "../schedules/model";
import { SELECTED_TEXT_STYLE } from "./selection-style";

const READ_ONLY_BANNER =
    "Schedules are read-only here. The production Taskflow instance owns the scheduler.";

interface SchedulesDeps {
    renderer: CliRenderer;
    schedules: readonly Schedule[];
    projects: readonly Project[];
    schedulerEnabled: boolean;
    onCreate(): Promise<void>;
    onEdit(schedule: Schedule): Promise<void>;
    onDelete(schedule: Schedule): Promise<void>;
    onToggle(schedule: Schedule): Promise<void>;
    onTrigger(schedule: Schedule): Promise<void>;
    confirm(message: string): Promise<boolean>;
    onClose(): void;
}

class Schedules {
    readonly renderable: BoxRenderable;
    private schedules: Schedule[];
    private selected = 0;
    private pending = false;
    private error: string | null = null;

    constructor(private readonly deps: SchedulesDeps) {
        this.schedules = [...deps.schedules];
        this.renderable = new BoxRenderable(deps.renderer, {
            id: "schedules",
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

    get selectedId(): string | null {
        return this.schedules[this.selected]?.id ?? null;
    }

    update(schedules: readonly Schedule[]): void {
        const id = this.selectedId;
        const index = this.selected;
        this.schedules = [...schedules];
        this.selected = stableSelectionIndex(this.schedules, id, index);
        this.pending = false;
        this.rebuild();
    }

    handleKey(event: KeyEvent): void {
        if (event.eventType !== "press" || this.pending) return;
        if (event.name === "escape" || event.sequence === "q") return this.deps.onClose();
        if (event.name === "down" || event.sequence === "j") return this.move(1);
        if (event.name === "up" || event.sequence === "k") return this.move(-1);
        if (!this.deps.schedulerEnabled) return;
        if (event.sequence === "n") {
            void this.run(() => this.deps.onCreate());
            return;
        }
        const schedule = this.schedules[this.selected];
        if (!schedule) return;
        if (event.sequence === "e") void this.run(() => this.deps.onEdit(schedule));
        else if (event.sequence === "d") {
            const suffix = schedule.runningSessionId ? " Its running session will be closed." : "";
            void this.confirmAndRun(`Delete ${schedule.name}?${suffix}`, () =>
                this.deps.onDelete(schedule),
            );
        } else if (event.name === "space" || event.sequence === " ") {
            void this.run(() => this.deps.onToggle(schedule));
        } else if (event.sequence === "t") {
            void this.confirmAndRun(`Trigger ${schedule.name} now?`, () =>
                this.deps.onTrigger(schedule),
            );
        }
    }

    private async confirmAndRun(message: string, operation: () => Promise<void>): Promise<void> {
        if (!(await this.deps.confirm(message))) return;
        await this.run(operation);
    }

    private async run(operation: () => Promise<void>): Promise<void> {
        this.pending = true;
        this.error = null;
        this.rebuild();
        try {
            await operation();
        } catch (error) {
            this.error = error instanceof Error ? error.message : String(error);
        } finally {
            this.pending = false;
            this.rebuild();
        }
    }

    private move(delta: number): void {
        if (this.schedules.length === 0) return;
        this.selected = Math.min(this.schedules.length - 1, Math.max(0, this.selected + delta));
        this.rebuild();
    }

    private rebuild(): void {
        for (const child of [...this.renderable.getChildren()]) child.destroy();
        this.renderable.add(
            new TextRenderable(this.deps.renderer, { content: " Schedules", height: 1 }),
        );
        if (!this.deps.schedulerEnabled) {
            this.renderable.add(
                new TextRenderable(this.deps.renderer, {
                    content: ` ${READ_ONLY_BANNER}`,
                    height: 2,
                    wrapMode: "word",
                }),
            );
        }
        for (const [index, schedule] of this.schedules.entries()) {
            const project = this.deps.projects.find((item) => item.id === schedule.projectId);
            const details = [
                project?.name ?? schedule.projectId,
                schedule.expression,
                scheduleStatusText(schedule),
                schedule.nextRunAt ? `next ${schedule.nextRunAt}` : null,
                schedule.lastRunAt ? `last ${schedule.lastRunAt}` : null,
                schedule.runningSessionId ? `session ${schedule.runningSessionId}` : null,
                schedule.lastError ? `error ${schedule.lastError}` : null,
            ].filter(Boolean);
            this.renderable.add(
                new TextRenderable(this.deps.renderer, {
                    content: ` ${schedule.name}  ${details.join("  ")}`,
                    height: 1,
                    ...(index === this.selected ? SELECTED_TEXT_STYLE : {}),
                    onMouseDown: (event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        this.selected = index;
                        this.rebuild();
                    },
                }),
            );
        }
        if (this.schedules.length === 0) {
            this.renderable.add(
                new TextRenderable(this.deps.renderer, { content: " No schedules.", height: 1 }),
            );
        }
        this.renderable.add(
            new TextRenderable(this.deps.renderer, {
                content: this.pending
                    ? " Working..."
                    : this.error
                      ? ` ${this.error}`
                      : this.deps.schedulerEnabled
                        ? " n/e/d: edit  Space: enable/disable  t: trigger  q: sessions"
                        : " j/k: navigate  q: sessions",
                height: 1,
            }),
        );
    }

    destroy(): void {
        this.renderable.destroy();
    }
}

export { READ_ONLY_BANNER, Schedules };
export type { SchedulesDeps };
