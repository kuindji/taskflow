import {
    BoxRenderable,
    InputRenderable,
    TextRenderable,
    type CliRenderer,
    type KeyEvent,
} from "@opentui/core";

interface OwnerFilterDeps {
    renderer: CliRenderer;
    initialValue: string;
    onCancel(): void;
    onSubmit(value: string): void;
    onStateChange?(): void;
}

class OwnerFilter {
    readonly renderable: BoxRenderable;
    private readonly input: InputRenderable;

    constructor(private readonly deps: OwnerFilterDeps) {
        this.renderable = new BoxRenderable(deps.renderer, {
            id: "owner-filter-overlay",
            position: "absolute",
            width: "100%",
            height: "100%",
            zIndex: 100,
            onMouseDown: (event) => {
                event.preventDefault();
                event.stopPropagation();
            },
        });
        const dialog = new BoxRenderable(deps.renderer, {
            id: "owner-filter-dialog",
            title: "Filter owners",
            border: true,
            position: "absolute",
            left: "20%",
            top: "25%",
            width: "60%",
            maxWidth: 64,
            minHeight: 5,
            flexDirection: "column",
            backgroundColor: "#000000",
        });
        dialog.add(
            new TextRenderable(deps.renderer, {
                content: " Match project names and task titles. Submit an empty value to clear.",
                minHeight: 2,
                wrapMode: "word",
            }),
        );
        this.input = new InputRenderable(deps.renderer, {
            id: "owner-filter-value",
            placeholder: "Owner name",
            value: deps.initialValue,
            width: "100%",
        });
        dialog.add(this.input);
        this.renderable.add(dialog);
        this.input.focus();
    }

    get keyHints(): string {
        return " Enter Apply  Esc Cancel";
    }

    handleKey(event: KeyEvent): void {
        if (event.eventType !== "press") return;
        const chorded = event.ctrl || event.meta || event.option || event.super || event.hyper;
        if (event.name === "escape" && !chorded) {
            this.deps.onCancel();
            return;
        }
        if (chorded) return;
        if (event.name === "return" || event.name === "enter") {
            this.deps.onSubmit(this.input.value.trim());
            return;
        }
        this.input.handleKeyPress(event);
        this.deps.onStateChange?.();
    }

    destroy(): void {
        this.renderable.destroy();
    }
}

export { OwnerFilter };
export type { OwnerFilterDeps };
