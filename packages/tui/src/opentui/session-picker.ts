import {
    BoxRenderable,
    TextAttributes,
    TextRenderable,
    type CliRenderer,
    type KeyEvent,
} from "@opentui/core";
import type { SessionPickerItem } from "../sessions/create-model";

interface SessionPickerDeps {
    renderer: CliRenderer;
    onCancel(): void;
    onSubmit(item: SessionPickerItem): void;
}

function singleLine(message: string): string {
    let result = "";
    for (const char of message) {
        const code = char.codePointAt(0) ?? 0;
        result += code < 0x20 || (code >= 0x7f && code <= 0x9f) ? " " : char;
    }
    return result;
}

class SessionPicker {
    readonly renderable: BoxRenderable;
    private readonly dialog: BoxRenderable;
    private items: SessionPickerItem[] = [];
    private selected = 0;
    private loading = true;
    private pending = false;
    private error: string | null = null;

    constructor(private readonly deps: SessionPickerDeps) {
        this.renderable = new BoxRenderable(deps.renderer, {
            id: "session-picker",
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
            id: "session-picker-dialog",
            title: "New session",
            border: true,
            position: "absolute",
            left: "20%",
            top: "20%",
            width: "60%",
            maxWidth: 60,
            minHeight: 5,
            flexDirection: "column",
            backgroundColor: "#000000",
        });
        this.renderable.add(this.dialog);
        this.rebuild();
    }

    setItems(items: readonly SessionPickerItem[]): void {
        this.items = [...items];
        this.loading = false;
        this.error = items.length === 0 ? "No agents or shells are available." : null;
        this.selected = Math.min(this.selected, Math.max(0, items.length - 1));
        this.rebuild();
    }

    setError(error: string): void {
        this.loading = false;
        this.pending = false;
        this.error = error;
        this.rebuild();
    }

    setPending(pending: boolean): void {
        this.pending = pending;
        this.rebuild();
    }

    handleKey(event: KeyEvent): void {
        if (event.eventType !== "press") return;
        const chorded = event.ctrl || event.meta || event.option || event.super || event.hyper;
        if (this.pending) return;
        if (event.name === "escape" && !chorded) {
            this.deps.onCancel();
            return;
        }
        if (this.loading || chorded || event.shift) return;
        if (event.name === "down" || event.sequence === "j") {
            if (this.items.length > 0)
                this.selected = Math.min(this.items.length - 1, this.selected + 1);
            this.rebuild();
            return;
        }
        if (event.name === "up" || event.sequence === "k") {
            this.selected = Math.max(0, this.selected - 1);
            this.rebuild();
            return;
        }
        if (event.name === "return" || event.name === "enter") this.submitSelected();
    }

    private submitSelected(): void {
        if (this.pending) return;
        const item = this.items[this.selected];
        if (item) this.deps.onSubmit(item);
    }

    private clear(): void {
        for (const child of [...this.dialog.getChildren()]) child.destroy();
    }

    private rebuild(): void {
        this.clear();
        if (this.loading) {
            this.dialog.add(
                new TextRenderable(this.deps.renderer, { content: " Loading...", height: 1 }),
            );
            return;
        }
        for (const [index, item] of this.items.entries()) {
            const suffix = item.isDefault ? " (default)" : "";
            this.dialog.add(
                new TextRenderable(this.deps.renderer, {
                    content: ` ${item.kind === "agent" ? "Agent" : "Shell"}: ${item.label}${suffix}`,
                    height: 1,
                    attributes: index === this.selected ? TextAttributes.INVERSE : 0,
                    onMouseDown: (event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        this.selected = index;
                        this.rebuild();
                        this.submitSelected();
                    },
                }),
            );
        }
        if (this.pending) {
            this.dialog.add(
                new TextRenderable(this.deps.renderer, { content: " Starting...", height: 1 }),
            );
        } else if (this.error) {
            this.dialog.add(
                new TextRenderable(this.deps.renderer, {
                    content: ` ${singleLine(this.error)}`,
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

export { SessionPicker };
export type { SessionPickerDeps };
