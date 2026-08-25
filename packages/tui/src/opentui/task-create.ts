import {
    BoxRenderable,
    InputRenderable,
    TextRenderable,
    type CliRenderer,
    type KeyEvent,
} from "@opentui/core";
import type { TaskCreatePayload } from "@taskflow/shared";
import { SELECTED_TEXT_STYLE } from "./selection-style";

type TaskCreateField = "title" | "description" | "worktree" | "initCommand";

interface TaskCreateDeps {
    renderer: CliRenderer;
    projectId: string;
    parentId?: string;
    onCancel(): void;
    onSubmit(payload: TaskCreatePayload): void;
    onStateChange?(): void;
}

const FIELDS: readonly TaskCreateField[] = ["title", "description", "worktree", "initCommand"];

class TaskCreate {
    readonly renderable: BoxRenderable;
    private readonly dialog: BoxRenderable;
    private input!: InputRenderable;
    private fieldIndex = 0;
    private readonly values: Record<Exclude<TaskCreateField, "worktree">, string> = {
        title: "",
        description: "",
        initCommand: "",
    };
    private worktree = false;
    private pending = false;
    private error: string | null = null;

    constructor(private readonly deps: TaskCreateDeps) {
        this.renderable = new BoxRenderable(deps.renderer, {
            id: "task-create-overlay",
            position: "absolute",
            width: "100%",
            height: "100%",
            zIndex: 100,
            onMouseDown: (event) => {
                event.preventDefault();
                event.stopPropagation();
            },
        });
        this.dialog = new BoxRenderable(deps.renderer, {
            id: "task-create-dialog",
            title: deps.parentId ? "New subtask" : "New task",
            border: true,
            position: "absolute",
            left: "15%",
            top: "18%",
            width: "70%",
            maxWidth: 72,
            minHeight: 10,
            flexDirection: "column",
            backgroundColor: "#000000",
        });
        this.renderable.add(this.dialog);
        this.rebuild();
    }

    get keyHints(): string {
        return this.pending
            ? " Creating..."
            : " ↑↓ Field  Space Toggle  Enter Create  Esc Cancel";
    }

    get selectedField(): TaskCreateField {
        return FIELDS[this.fieldIndex]!;
    }

    setField(field: Exclude<TaskCreateField, "worktree">, value: string): void {
        this.values[field] = value;
        if (this.selectedField === field) this.input.value = value;
        this.error = null;
        this.rebuild();
    }

    setWorktree(enabled: boolean): void {
        this.worktree = enabled;
        this.rebuild();
    }

    setPending(pending: boolean): void {
        this.pending = pending;
        this.rebuild();
    }

    setError(error: string): void {
        this.pending = false;
        this.error = error;
        this.rebuild();
    }

    handleKey(event: KeyEvent): void {
        if (event.eventType !== "press" || this.pending) return;
        const chorded = event.ctrl || event.meta || event.option || event.super || event.hyper;
        if (event.name === "escape" && !chorded) return this.deps.onCancel();
        if (chorded) return;
        if (event.name === "down" || event.name === "tab") return this.move(1);
        if (event.name === "up") return this.move(-1);
        if (this.selectedField === "worktree" && event.sequence === " ") {
            this.worktree = !this.worktree;
            this.rebuild();
            return;
        }
        if (event.name === "return" || event.name === "enter") return this.submit();
        if (this.selectedField !== "worktree") {
            this.input.handleKeyPress(event);
            this.values[this.selectedField] = this.input.value;
        }
    }

    private move(delta: number): void {
        if (this.selectedField !== "worktree") this.values[this.selectedField] = this.input.value;
        this.fieldIndex = Math.min(FIELDS.length - 1, Math.max(0, this.fieldIndex + delta));
        this.rebuild();
    }

    private submit(): void {
        if (this.selectedField !== "worktree") this.values[this.selectedField] = this.input.value;
        const title = this.values.title.trim();
        const description = this.values.description.trim();
        if (!title || !description) {
            this.error = "Title and description are required.";
            this.rebuild();
            return;
        }
        this.pending = true;
        this.error = null;
        this.rebuild();
        this.deps.onSubmit({
            projectId: this.deps.projectId,
            parentId: this.deps.parentId,
            title,
            description,
            worktree: this.deps.parentId ? undefined : this.worktree,
            initCommand:
                !this.deps.parentId && this.worktree && this.values.initCommand.trim()
                    ? this.values.initCommand.trim()
                    : undefined,
        });
    }

    private rebuild(): void {
        for (const child of [...this.dialog.getChildren()]) child.destroy();
        for (const [index, field] of FIELDS.entries()) {
            const unavailable = this.deps.parentId && (field === "worktree" || field === "initCommand");
            const value =
                field === "worktree"
                    ? this.deps.parentId
                        ? "inherited"
                        : this.worktree
                          ? "yes"
                          : "no"
                    : this.values[field];
            this.dialog.add(
                new TextRenderable(this.deps.renderer, {
                    content: ` ${field === "initCommand" ? "Init command" : field[0]!.toUpperCase() + field.slice(1)}: ${value || ""}${unavailable ? "  [inherited]" : ""}`,
                    height: 1,
                    ...(index === this.fieldIndex ? SELECTED_TEXT_STYLE : {}),
                }),
            );
        }
        const field = this.selectedField;
        this.input = new InputRenderable(this.deps.renderer, {
            id: "task-create-value",
            placeholder: field === "worktree" ? "Use Space to toggle" : `Enter ${field}`,
            value: field === "worktree" ? "" : this.values[field],
            width: "100%",
        });
        if (field !== "worktree" && !(this.deps.parentId && field === "initCommand")) {
            this.dialog.add(this.input);
            this.input.focus();
        }
        if (this.pending) {
            this.dialog.add(new TextRenderable(this.deps.renderer, { content: " Creating...", height: 1 }));
        } else if (this.error) {
            this.dialog.add(
                new TextRenderable(this.deps.renderer, { content: ` ${this.error}`, height: 1 }),
            );
        }
        this.deps.onStateChange?.();
    }

    destroy(): void {
        this.renderable.destroy();
    }
}

export { TaskCreate };
export type { TaskCreateDeps, TaskCreateField };
