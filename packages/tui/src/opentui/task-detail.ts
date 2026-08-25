import {
    InputRenderable,
    ScrollBoxRenderable,
    TextRenderable,
    type CliRenderer,
    type KeyEvent,
} from "@opentui/core";
import type { Project, ResolvedAttribute, Task, TaskLogEntry } from "@taskflow/shared";
import { SELECTED_TEXT_STYLE } from "./selection-style";

interface TaskDetailDeps {
    renderer: CliRenderer;
    task: Task;
    project: Project | null;
    attributes: readonly ResolvedAttribute[];
    logs: readonly TaskLogEntry[];
    onEditDescription(): void;
    onEditNotes(): void;
    onEditTitle(title: string): void;
    onCreateAttribute(name: string, value: string): void;
    onUpdateAttribute(attribute: ResolvedAttribute, value: string): void;
    onDeleteAttribute(attribute: ResolvedAttribute): void;
    onTogglePin(): void;
    onArchive(): void;
    onClose(): void;
    onStateChange?(): void;
}

function cleanMultiline(value: string): string {
    let result = "";
    for (const char of value) {
        const code = char.codePointAt(0) ?? 0;
        result += code < 0x09 || (code > 0x0d && code < 0x20) || (code >= 0x7f && code <= 0x9f)
            ? "�"
            : char;
    }
    return result;
}

function taskLogLabel(entry: TaskLogEntry): string {
    const timestamp = Number.isNaN(Date.parse(entry.timestamp))
        ? entry.timestamp
        : new Date(entry.timestamp).toISOString().replace("T", " ").slice(0, 19);
    return `${timestamp}  ${entry.type}  ${entry.message}`;
}

class TaskDetail {
    readonly renderable: ScrollBoxRenderable;
    private task: Task;
    private project: Project | null;
    private attributes: ResolvedAttribute[];
    private logs: TaskLogEntry[];
    private pending = false;
    private error: string | null = null;
    private selectedAttribute = 0;
    private editKind: "title" | "attribute-name" | "attribute-value" | "attribute-update" | null =
        null;
    private editInput: InputRenderable | null = null;
    private attributeNameDraft = "";

    constructor(private readonly deps: TaskDetailDeps) {
        this.task = deps.task;
        this.project = deps.project;
        this.attributes = [...deps.attributes];
        this.logs = [...deps.logs];
        this.renderable = new ScrollBoxRenderable(deps.renderer, {
            id: "task-detail",
            width: "100%",
            height: "100%",
            flexDirection: "column",
            overflow: "scroll",
            onMouseScroll: (event) => {
                const direction = event.scroll?.direction;
                if (direction !== "up" && direction !== "down") return;
                event.preventDefault();
                event.stopPropagation();
                this.renderable.scrollBy(direction === "up" ? -3 : 3);
            },
        });
        this.rebuild();
    }

    get taskId(): string {
        return this.task.id;
    }

    get keyHints(): string {
        if (this.editKind) return " Enter Save  Esc Cancel";
        return this.pending
            ? " Working..."
            : " r Title  e Description  o Notes  ↑↓ Attribute  n Add  u Update  d Delete  p Pin  a Archive  Esc/q Sessions";
    }

    update(
        task: Task,
        project: Project | null,
        attributes: readonly ResolvedAttribute[],
        logs: readonly TaskLogEntry[],
    ): void {
        this.task = task;
        this.project = project;
        this.attributes = [...attributes];
        this.logs = [...logs];
        this.pending = false;
        this.editKind = null;
        this.editInput = null;
        this.selectedAttribute = Math.min(
            this.selectedAttribute,
            Math.max(0, this.attributes.length - 1),
        );
        this.rebuild();
    }

    setPending(pending: boolean): void {
        this.pending = pending;
        this.error = null;
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
        if (chorded) return;
        if (this.editKind) return this.handleEditKey(event);
        if (event.name === "escape" || event.sequence === "q") return this.deps.onClose();
        if (event.name === "down" || event.sequence === "j") return this.moveAttribute(1);
        if (event.name === "up" || event.sequence === "k") return this.moveAttribute(-1);
        if (event.sequence === "r") return this.beginEdit("title", this.task.title);
        if (event.sequence === "e") return this.deps.onEditDescription();
        if (event.sequence === "o") return this.deps.onEditNotes();
        if (event.sequence === "n") return this.beginEdit("attribute-name", "");
        if (event.sequence === "u") {
            const attribute = this.attributes[this.selectedAttribute];
            if (!attribute || attribute.scope !== "task") {
                this.setError("Inherited attributes are read-only.");
                return;
            }
            return this.beginEdit("attribute-update", attribute.value);
        }
        if (event.sequence === "d") {
            const attribute = this.attributes[this.selectedAttribute];
            if (!attribute || attribute.scope !== "task") {
                this.setError("Inherited attributes are read-only.");
                return;
            }
            this.pending = true;
            this.rebuild();
            this.deps.onDeleteAttribute(attribute);
            return;
        }
        if (event.sequence === "p") return this.deps.onTogglePin();
        if (event.sequence === "a") return this.deps.onArchive();
        if (event.name === "pagedown") this.renderable.scrollBy(8);
        if (event.name === "pageup") this.renderable.scrollBy(-8);
    }

    private moveAttribute(delta: number): void {
        if (this.attributes.length === 0) return;
        this.selectedAttribute = Math.min(
            this.attributes.length - 1,
            Math.max(0, this.selectedAttribute + delta),
        );
        this.error = null;
        this.rebuild();
    }

    private beginEdit(
        kind: "title" | "attribute-name" | "attribute-value" | "attribute-update",
        value: string,
    ): void {
        this.editKind = kind;
        this.error = null;
        this.rebuild(value);
        this.editInput?.focus();
    }

    private handleEditKey(event: KeyEvent): void {
        if (event.name === "escape") {
            this.editKind = null;
            this.editInput = null;
            this.error = null;
            this.rebuild();
            return;
        }
        if (event.name !== "return" && event.name !== "enter") {
            this.editInput?.handleKeyPress(event);
            return;
        }
        const value = this.editInput?.value.trim() ?? "";
        if (this.editKind === "title") {
            if (!value) return this.setError("Title is required.");
            this.pending = true;
            this.deps.onEditTitle(value);
        } else if (this.editKind === "attribute-name") {
            if (!value) return this.setError("Attribute name is required.");
            this.attributeNameDraft = value;
            this.beginEdit("attribute-value", "");
            return;
        } else if (this.editKind === "attribute-value") {
            this.pending = true;
            this.deps.onCreateAttribute(this.attributeNameDraft, value);
        } else {
            const attribute = this.attributes[this.selectedAttribute];
            if (!attribute || attribute.scope !== "task") return;
            this.pending = true;
            this.deps.onUpdateAttribute(attribute, value);
        }
        this.rebuild();
    }

    private addLine(content: string, selected = false): void {
        this.renderable.add(
            new TextRenderable(this.deps.renderer, {
                content,
                width: "100%",
                minHeight: 1,
                wrapMode: "word",
                selectable: true,
                ...(selected ? SELECTED_TEXT_STYLE : {}),
            }),
        );
    }

    private rebuild(editValue?: string): void {
        const retainedEditValue = editValue ?? this.editInput?.value ?? "";
        for (const child of [...this.renderable.getChildren()]) child.destroy();
        this.addLine(` ${cleanMultiline(this.task.title)}${this.task.pinned ? "  [pinned]" : ""}`, true);
        this.addLine(` Project: ${cleanMultiline(this.project?.name ?? this.task.projectId)}`);
        const worktree = this.task.worktree.enabled
            ? this.task.worktree.path ?? "initializing"
            : "disabled";
        this.addLine(` Worktree: ${cleanMultiline(worktree)}`);
        this.addLine("");
        this.addLine(" Description");
        this.addLine(` ${cleanMultiline(this.task.description || "No description.")}`);
        this.addLine("");
        this.addLine(" Notes");
        this.addLine(` ${cleanMultiline(this.task.notes || "No notes.")}`);
        this.addLine("");
        this.addLine(" Attributes");
        if (this.attributes.length === 0) this.addLine(" No attributes.");
        for (const [index, attribute] of this.attributes.entries()) {
            const readOnly = attribute.scope === "task" ? "" : "  [read-only]";
            this.addLine(
                ` ${cleanMultiline(attribute.name)} = ${cleanMultiline(attribute.value)}  (${attribute.scope})${readOnly}`,
                index === this.selectedAttribute,
            );
        }
        this.addLine("");
        this.addLine(" Activity");
        if (this.logs.length === 0) this.addLine(" No task activity.");
        for (const log of this.logs) this.addLine(` ${cleanMultiline(taskLogLabel(log))}`);
        if (this.editKind) {
            const label =
                this.editKind === "title"
                    ? "New title"
                    : this.editKind === "attribute-name"
                      ? "Attribute name"
                      : this.editKind === "attribute-value"
                        ? `Value for ${this.attributeNameDraft}`
                        : `New value for ${this.attributes[this.selectedAttribute]?.name ?? "attribute"}`;
            this.addLine(` ${label}`);
            this.editInput = new InputRenderable(this.deps.renderer, {
                id: "task-detail-edit-input",
                value: retainedEditValue,
                width: "100%",
            });
            this.renderable.add(this.editInput);
        }
        if (this.pending) this.addLine(" Working...");
        if (this.error) this.addLine(` ${cleanMultiline(this.error)}`);
        this.deps.onStateChange?.();
    }

    destroy(): void {
        this.renderable.destroy();
    }
}

export { TaskDetail, cleanMultiline, taskLogLabel };
export type { TaskDetailDeps };
