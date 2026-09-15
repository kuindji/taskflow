import {
    BoxRenderable,
    InputRenderable,
    TextRenderable,
    type CliRenderer,
    type KeyEvent,
} from "@opentui/core";
import { editLine, isChorded } from "./line-input";
import { completePath, type PathCompletion } from "./path-input";
import { SELECTED_TEXT_STYLE } from "./selection-style";

type ProjectAddField = "path" | "name";

interface ProjectAddDeps {
    renderer: CliRenderer;
    onCancel(): void;
    onSubmit(path: string, name?: string): void;
    /** Completes the path on Tab. Reads this machine's filesystem by default. */
    complete?: (input: string) => Promise<PathCompletion>;
    onStateChange?(): void;
}

const FIELDS: readonly ProjectAddField[] = ["path", "name"];
const FIELD_LABELS: Readonly<Record<ProjectAddField, string>> = {
    path: "Project path",
    name: "Name (optional)",
};

class ProjectAdd {
    readonly renderable: BoxRenderable;
    private readonly dialog: BoxRenderable;
    private input!: InputRenderable;
    private fieldIndex = 0;
    private readonly values: Record<ProjectAddField, string> = { path: "", name: "" };
    private candidates: string[] = [];
    private completionToken = 0;
    private pending = false;
    private error: string | null = null;
    private destroyed = false;

    constructor(private readonly deps: ProjectAddDeps) {
        this.renderable = new BoxRenderable(deps.renderer, {
            id: "project-add-overlay",
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
            id: "project-add-dialog",
            title: "Add project",
            border: true,
            position: "absolute",
            left: "15%",
            top: "25%",
            width: "70%",
            maxWidth: 72,
            minHeight: 6,
            flexDirection: "column",
            backgroundColor: "#000000",
        });
        this.renderable.add(this.dialog);
        this.rebuild();
    }

    get keyHints(): string {
        if (this.pending) return " Adding...";
        return this.field === "path"
            ? " Tab Complete  ↑↓ Field  Enter Add  Esc Cancel"
            : " ↑↓ Field  Enter Add  Esc Cancel";
    }

    setError(error: string): void {
        this.pending = false;
        this.error = error;
        this.rebuild();
    }

    handleKey(event: KeyEvent): void {
        if (event.eventType !== "press" || this.pending) return;
        if (!isChorded(event)) {
            if (event.name === "down" || event.name === "up") {
                this.values[this.field] = this.input.value;
                this.fieldIndex = event.name === "down" ? 1 : 0;
                this.rebuild();
                return;
            }
            if (event.name === "tab") {
                if (this.field === "path") this.complete();
                return;
            }
        }
        switch (editLine(this.input, event)) {
            case "cancel":
                this.deps.onCancel();
                return;
            case "submit":
                this.submit();
                return;
            case "edit":
                this.values[this.field] = this.input.value;
                if (this.candidates.length > 0) {
                    this.candidates = [];
                    this.rebuild();
                }
                return;
            default:
                return;
        }
    }

    private get field(): ProjectAddField {
        return FIELDS[this.fieldIndex];
    }

    private complete(): void {
        const token = ++this.completionToken;
        const typed = this.input.value;
        const complete = this.deps.complete ?? ((input: string) => completePath(input));
        complete(typed).then(
            (result) => {
                if (
                    this.destroyed ||
                    token !== this.completionToken ||
                    this.field !== "path" ||
                    this.input.value !== typed
                ) {
                    return;
                }
                this.values.path = result.value;
                this.candidates = result.candidates.length > 1 ? result.candidates : [];
                this.rebuild();
            },
            () => undefined,
        );
    }

    private submit(): void {
        this.values[this.field] = this.input.value;
        const path = this.values.path.trim();
        if (!path) {
            this.error = "A path is required.";
            this.rebuild();
            return;
        }
        const name = this.values.name.trim();
        this.pending = true;
        this.error = null;
        this.rebuild();
        this.deps.onSubmit(path, name || undefined);
    }

    private rebuild(): void {
        if (this.destroyed) return;
        for (const child of [...this.dialog.getChildren()]) child.destroy();
        for (const [index, field] of FIELDS.entries()) {
            this.dialog.add(
                new TextRenderable(this.deps.renderer, {
                    content: ` ${FIELD_LABELS[field]}: ${this.values[field]}`,
                    height: 1,
                    truncate: true,
                    ...(index === this.fieldIndex ? SELECTED_TEXT_STYLE : {}),
                }),
            );
        }
        this.input = new InputRenderable(this.deps.renderer, {
            id: "project-add-value",
            placeholder: this.field === "path" ? "~/path/to/folder" : "Defaults to the folder name",
            value: this.values[this.field],
            width: "100%",
        });
        this.dialog.add(this.input);
        this.input.focus();
        if (this.candidates.length > 0) {
            this.dialog.add(
                new TextRenderable(this.deps.renderer, {
                    content: ` ${this.candidates.join("  ")}`,
                    height: 1,
                    truncate: true,
                }),
            );
        }
        if (this.pending) {
            this.dialog.add(
                new TextRenderable(this.deps.renderer, { content: " Adding...", height: 1 }),
            );
        } else if (this.error) {
            this.dialog.add(
                new TextRenderable(this.deps.renderer, {
                    content: ` ${this.error}`,
                    minHeight: 1,
                    wrapMode: "word",
                }),
            );
        }
        this.deps.onStateChange?.();
    }

    destroy(): void {
        this.destroyed = true;
        this.renderable.destroy();
    }
}

export { ProjectAdd };
export type { ProjectAddDeps };
