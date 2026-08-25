import {
    BoxRenderable,
    InputRenderable,
    TextRenderable,
    type CliRenderer,
    type KeyEvent,
} from "@opentui/core";

interface GitCommitDeps {
    renderer: CliRenderer;
    onCancel(): void;
    onGenerate(): void;
    onSubmit(message: string): void;
    onStateChange?(): void;
}

class GitCommit {
    readonly renderable: BoxRenderable;
    private readonly dialog: BoxRenderable;
    private input!: InputRenderable;
    private message = "";
    private pending: "generate" | "commit" | null = null;
    private error: string | null = null;

    constructor(private readonly deps: GitCommitDeps) {
        this.renderable = new BoxRenderable(deps.renderer, {
            id: "git-commit-overlay",
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
            title: "Commit staged changes",
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
        this.input.focus();
    }

    get keyHints(): string {
        if (this.pending === "generate") return " Generating message...";
        if (this.pending === "commit") return " Committing...";
        return " Enter Commit  G Generate  Esc Cancel";
    }

    setGenerated(message: string): void {
        this.message = message;
        this.pending = null;
        this.error = null;
        this.rebuild();
        this.input.focus();
    }

    setError(error: string): void {
        this.pending = null;
        this.error = error;
        this.rebuild();
        this.input.focus();
    }

    handleKey(event: KeyEvent): void {
        if (event.eventType !== "press" || this.pending) return;
        const chorded = event.ctrl || event.meta || event.option || event.super || event.hyper;
        if (event.name === "escape" && !chorded) return this.deps.onCancel();
        if (chorded) return;
        if (event.sequence === "G") {
            this.message = this.input.value;
            this.pending = "generate";
            this.error = null;
            this.rebuild();
            this.deps.onGenerate();
            return;
        }
        if (event.name === "return" || event.name === "enter") {
            this.message = this.input.value.trim();
            if (!this.message) {
                this.error = "Commit message is required.";
                this.rebuild();
                this.input.focus();
                return;
            }
            this.pending = "commit";
            this.error = null;
            this.rebuild();
            this.deps.onSubmit(this.message);
            return;
        }
        this.input.handleKeyPress(event);
        this.message = this.input.value;
    }

    private rebuild(): void {
        for (const child of [...this.dialog.getChildren()]) child.destroy();
        this.dialog.add(
            new TextRenderable(this.deps.renderer, {
                content: " Only staged files will be committed. This never pushes.",
                height: 1,
            }),
        );
        this.input = new InputRenderable(this.deps.renderer, {
            id: "git-commit-message",
            placeholder: "Commit message",
            value: this.message,
            width: "100%",
        });
        this.dialog.add(this.input);
        if (this.pending) {
            this.dialog.add(
                new TextRenderable(this.deps.renderer, {
                    content: this.pending === "generate" ? " Generating..." : " Committing...",
                    height: 1,
                }),
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
        this.renderable.destroy();
    }
}

export { GitCommit };
export type { GitCommitDeps };
