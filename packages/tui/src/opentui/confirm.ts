import { BoxRenderable, TextRenderable, type CliRenderer, type KeyEvent } from "@opentui/core";

interface ConfirmDeps {
    renderer: CliRenderer;
    title: string;
    message: string;
    onConfirm(): void;
    onCancel(): void;
}

class Confirm {
    readonly renderable: BoxRenderable;
    private readonly dialog: BoxRenderable;
    private pending = false;
    private error: string | null = null;

    constructor(private readonly deps: ConfirmDeps) {
        this.renderable = new BoxRenderable(deps.renderer, {
            id: "confirm-overlay",
            position: "absolute",
            width: "100%",
            height: "100%",
            zIndex: 110,
            onMouseDown: (event) => {
                event.preventDefault();
                event.stopPropagation();
            },
        });
        this.dialog = new BoxRenderable(deps.renderer, {
            title: deps.title,
            border: true,
            position: "absolute",
            left: "20%",
            top: "30%",
            width: "60%",
            maxWidth: 64,
            minHeight: 5,
            flexDirection: "column",
            backgroundColor: "#000000",
        });
        this.renderable.add(this.dialog);
        this.rebuild();
    }

    handleKey(event: KeyEvent): void {
        if (event.eventType !== "press") return;
        const chorded = event.ctrl || event.meta || event.option || event.super || event.hyper;
        if (chorded || event.shift || this.pending) return;
        if (event.name === "escape" || event.sequence === "n") {
            this.deps.onCancel();
            return;
        }
        if (event.sequence === "y" || event.name === "return" || event.name === "enter") {
            this.pending = true;
            this.error = null;
            this.rebuild();
            this.deps.onConfirm();
        }
    }

    setError(error: string): void {
        this.pending = false;
        this.error = error;
        this.rebuild();
    }

    private rebuild(): void {
        for (const child of [...this.dialog.getChildren()]) child.destroy();
        this.dialog.add(
            new TextRenderable(this.deps.renderer, {
                content: ` ${this.deps.message}`,
                height: 2,
                wrapMode: "word",
            }),
        );
        this.dialog.add(
            new TextRenderable(this.deps.renderer, {
                content: this.pending ? " Closing..." : " Enter/y: close  Escape/n: cancel",
                height: 1,
            }),
        );
        if (this.error) {
            this.dialog.add(
                new TextRenderable(this.deps.renderer, {
                    content: ` ${this.error}`,
                    height: 1,
                    wrapMode: "word",
                }),
            );
        }
    }

    destroy(): void {
        this.renderable.destroy();
    }
}

export { Confirm };
export type { ConfirmDeps };
