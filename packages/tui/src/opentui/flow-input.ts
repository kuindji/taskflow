import {
    BoxRenderable,
    InputRenderable,
    TextRenderable,
    type CliRenderer,
    type KeyEvent,
} from "@opentui/core";
import type { FlowInputDefinition } from "@taskflow/shared";

interface FlowInputDeps {
    renderer: CliRenderer;
    inputs: readonly FlowInputDefinition[];
    onCancel(): void;
    onSubmit(values: Record<string, string>): void;
}

class FlowInput {
    readonly renderable: BoxRenderable;
    private readonly dialog: BoxRenderable;
    private valueInput!: InputRenderable;
    private index = 0;
    private readonly values: Record<string, string> = {};
    private error: string | null = null;

    constructor(private readonly deps: FlowInputDeps) {
        this.renderable = new BoxRenderable(deps.renderer, {
            id: "flow-input-overlay",
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
            title: "Flow inputs",
            border: true,
            position: "absolute",
            left: "20%",
            top: "25%",
            width: "60%",
            minHeight: 5,
            flexDirection: "column",
            backgroundColor: "#000000",
        });
        this.renderable.add(this.dialog);
        this.rebuild();
        this.valueInput.focus();
    }

    setValue(value: string): void {
        this.valueInput.value = value;
    }

    handleKey(event: KeyEvent): void {
        if (event.eventType !== "press") return;
        if (event.name === "escape") {
            this.deps.onCancel();
            return;
        }
        if (event.name !== "return" && event.name !== "enter") return;
        const input = this.deps.inputs[this.index];
        const value = this.valueInput.value.trim();
        if (!input || !value) {
            this.error = "A value is required.";
            this.rebuild();
            return;
        }
        this.values[input.id] = value;
        if (this.index === this.deps.inputs.length - 1) {
            this.deps.onSubmit({ ...this.values });
            return;
        }
        this.index += 1;
        this.valueInput.value = "";
        this.error = null;
        this.rebuild();
        this.valueInput.focus();
    }

    private rebuild(): void {
        const currentValue = this.valueInput?.value ?? "";
        for (const child of [...this.dialog.getChildren()]) child.destroy();
        const input = this.deps.inputs[this.index];
        this.dialog.add(
            new TextRenderable(this.deps.renderer, {
                content: input
                    ? ` ${input.label} (${input.type === "filepath" ? "file path" : "text"})`
                    : " No inputs",
                height: 1,
            }),
        );
        this.valueInput = new InputRenderable(this.deps.renderer, {
            id: "flow-input-value",
            placeholder: "Enter a value",
            value: currentValue,
            width: "100%",
        });
        this.dialog.add(this.valueInput);
        this.dialog.add(
            new TextRenderable(this.deps.renderer, {
                content: this.error ? ` ${this.error}` : " Enter: next  Escape: cancel",
                height: 1,
            }),
        );
    }

    destroy(): void {
        this.renderable.destroy();
    }
}

export { FlowInput };
export type { FlowInputDeps };
