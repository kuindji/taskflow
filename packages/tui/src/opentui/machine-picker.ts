import {
    BoxRenderable,
    InputRenderable,
    TextAttributes,
    TextRenderable,
    type CliRenderer,
    type KeyEvent,
} from "@opentui/core";
import type { MenuEntry } from "@taskflow/shared";
import { buildPickerRows, initialIndex, type PickerRow } from "../remote/picker-model";
import { Confirm } from "./confirm";
import { deliverKeyToView } from "./keys";
import { SELECTED_TEXT_STYLE } from "./selection-style";
import { singleLine } from "./session-picker";

interface AddMachineInput {
    host: string;
    user?: string;
    sshPort?: number;
    port?: number;
}

interface MachinePickerDeps {
    renderer: CliRenderer;
    entries: MenuEntry[];
    lastMachineId: string | null;
    /** `launch`: nothing is behind the picker, so Esc quits. `switch`: Esc closes. */
    mode: "launch" | "switch";
    onPick(row: PickerRow): void;
    onAdd(input: AddMachineInput): void;
    onRename(id: string, name: string): void;
    onForget(id: string): void;
    onCancel(): void;
}

type AddField = "host" | "user" | "sshPort" | "port";

const ADD_FIELDS: ReadonlyArray<{ field: AddField; label: string }> = [
    { field: "host", label: "Host" },
    { field: "user", label: "SSH user" },
    { field: "sshPort", label: "SSH port" },
    { field: "port", label: "Backend port" },
];

type PickerForm =
    | { kind: "add"; fieldIndex: number; values: Record<AddField, string> }
    | { kind: "rename"; id: string; name: string; value: string };

function rowKey(row: PickerRow): string {
    return row.kind === "machine" ? `machine:${row.entry.id}` : row.kind;
}

function rowLabel(row: PickerRow): string {
    if (row.kind === "local") return " This machine";
    if (row.kind === "add") return " Add machine…";
    const { entry } = row;
    const host = entry.host && entry.host !== entry.displayName ? ` (${entry.host})` : "";
    const status = !entry.saved ? "discovered, not saved" : entry.seen ? "on network" : "not seen";
    return ` ${entry.displayName}${host}  ${status}`;
}

/** Empty is "not given". Anything else has to be a whole port number. */
function parsePort(raw: string, label: string): number | undefined | { error: string } {
    const value = raw.trim();
    if (value === "") return undefined;
    const port = /^\d+$/.test(value) ? Number.parseInt(value, 10) : 0;
    if (port < 1 || port > 65535) return { error: `${label} must be a number from 1 to 65535.` };
    return port;
}

function isChorded(event: KeyEvent): boolean {
    return Boolean(event.ctrl || event.meta || event.option || event.super || event.hyper);
}

class MachinePicker {
    readonly renderable: BoxRenderable;
    private readonly dialog: BoxRenderable;
    private readonly footer: TextRenderable | null;
    private rows: PickerRow[];
    private selected: number;
    private form: PickerForm | null = null;
    private input: InputRenderable | null = null;
    private formError: string | null = null;
    private forget: Confirm | null = null;
    private failure: string | null = null;
    private pending: string | null = null;

    constructor(private readonly deps: MachinePickerDeps) {
        this.rows = buildPickerRows(deps.entries);
        this.selected = initialIndex(this.rows, deps.lastMachineId);
        this.renderable = new BoxRenderable(deps.renderer, {
            id: "machine-picker",
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
            id: "machine-picker-dialog",
            border: true,
            position: "absolute",
            left: "20%",
            top: "15%",
            width: "60%",
            maxWidth: 72,
            minHeight: 5,
            flexDirection: "column",
            backgroundColor: "#000000",
        });
        this.renderable.add(this.dialog);
        // At launch there is no app footer behind the picker to show its keys.
        this.footer =
            deps.mode === "launch"
                ? new TextRenderable(deps.renderer, {
                      id: "machine-picker-footer",
                      content: "",
                      position: "absolute",
                      bottom: 0,
                      left: 0,
                      width: "100%",
                      height: 1,
                      truncate: true,
                      wrapMode: "none",
                      attributes: TextAttributes.DIM,
                      selectable: false,
                  })
                : null;
        if (this.footer) this.renderable.add(this.footer);
        this.rebuild();
    }

    get keyHints(): string {
        if (this.pending !== null) return ` ${this.pending}`;
        if (this.forget) return this.forget.keyHints;
        if (this.form?.kind === "add") return " ↑↓ Field  Enter Add  Esc Back";
        if (this.form?.kind === "rename") return " Enter Save  Esc Back";
        const row = this.rows[this.selected];
        const hints = ["↑↓ Select", row?.kind === "add" ? "Enter Add" : "Enter Connect", "a Add"];
        if (row?.kind === "machine" && row.entry.saved) hints.push("R Rename", "F Forget");
        hints.push(this.deps.mode === "launch" ? "Esc Quit" : "Esc Close");
        return ` ${hints.join("  ")}`;
    }

    /** Refresh the rows, keeping the same machine selected when it is still listed. */
    setEntries(entries: MenuEntry[]): void {
        const current = this.rows[this.selected];
        this.rows = buildPickerRows(entries);
        const index = current ? this.rows.findIndex((row) => rowKey(row) === rowKey(current)) : -1;
        this.selected = index === -1 ? Math.min(this.selected, this.rows.length - 1) : index;
        this.rebuild();
    }

    /** Shown under the rows until the next key press. Ends any pending state. */
    showFailure(message: string): void {
        this.pending = null;
        this.failure = singleLine(message);
        this.rebuild();
    }

    /** While a message is set the picker shows it and ignores keys. */
    setPending(message: string | null): void {
        this.pending = message;
        this.rebuild();
    }

    handleKey(event: KeyEvent): void {
        if (event.eventType !== "press" || this.pending !== null) return;
        if (this.forget) {
            this.forget.handleKey(event);
            return;
        }
        if (this.failure !== null) {
            this.failure = null;
            this.rebuild();
        }
        if (this.form) {
            this.handleFormKey(event, this.form);
            return;
        }
        if (event.name === "escape" && !isChorded(event)) {
            this.deps.onCancel();
            return;
        }
        if (isChorded(event)) return;
        if (event.name === "down" || event.sequence === "j") return this.move(1);
        if (event.name === "up" || event.sequence === "k") return this.move(-1);
        const row = this.rows[this.selected];
        if (event.name === "return" || event.name === "enter") {
            if (row?.kind === "add") return this.openAdd();
            if (row) this.deps.onPick(row);
            return;
        }
        if (event.sequence === "a") return this.openAdd();
        if (row?.kind !== "machine" || !row.entry.saved) return;
        if (event.sequence === "R") return this.openRename(row.entry);
        if (event.sequence === "F") return this.openForget(row.entry);
    }

    private move(delta: number): void {
        this.selected = Math.min(this.rows.length - 1, Math.max(0, this.selected + delta));
        this.rebuild();
    }

    private openAdd(): void {
        this.form = {
            kind: "add",
            fieldIndex: 0,
            values: { host: "", user: "", sshPort: "", port: "" },
        };
        this.formError = null;
        this.rebuild();
    }

    private openRename(entry: MenuEntry): void {
        this.form = {
            kind: "rename",
            id: entry.id,
            name: entry.displayName,
            value: entry.displayName,
        };
        this.formError = null;
        this.rebuild();
    }

    private openForget(entry: MenuEntry): void {
        const close = (): void => {
            this.forget?.destroy();
            this.forget = null;
            this.rebuild();
        };
        this.forget = new Confirm({
            renderer: this.deps.renderer,
            title: "Forget machine",
            message: `Forget ${entry.displayName}? Its saved connection details are removed.`,
            onCancel: close,
            onConfirm: () => {
                close();
                this.deps.onForget(entry.id);
            },
            onStateChange: () => this.updateFooter(),
        });
        this.renderable.add(this.forget.renderable);
        this.updateFooter();
    }

    private closeForm(): void {
        this.form = null;
        this.formError = null;
        this.rebuild();
    }

    /** Copy what the input holds back into the form before it is rebuilt or read. */
    private syncInput(form: PickerForm): void {
        if (!this.input) return;
        if (form.kind === "add") form.values[ADD_FIELDS[form.fieldIndex].field] = this.input.value;
        else form.value = this.input.value;
    }

    private handleFormKey(event: KeyEvent, form: PickerForm): void {
        const chorded = isChorded(event);
        if (event.name === "escape" && !chorded) return this.closeForm();
        if (chorded) return;
        if (form.kind === "add" && (event.name === "down" || event.name === "tab")) {
            return this.moveField(form, 1);
        }
        if (form.kind === "add" && event.name === "up") return this.moveField(form, -1);
        if (event.name === "return" || event.name === "enter") {
            this.syncInput(form);
            if (form.kind === "add") this.submitAdd(form);
            else this.submitRename(form);
            return;
        }
        this.input?.handleKeyPress(event);
        this.syncInput(form);
    }

    private moveField(form: Extract<PickerForm, { kind: "add" }>, delta: number): void {
        this.syncInput(form);
        form.fieldIndex = Math.min(ADD_FIELDS.length - 1, Math.max(0, form.fieldIndex + delta));
        this.rebuild();
    }

    private submitAdd(form: Extract<PickerForm, { kind: "add" }>): void {
        const host = form.values.host.trim();
        if (!host) return this.setFormError("Enter a host name or address.");
        const sshPort = parsePort(form.values.sshPort, "SSH port");
        if (typeof sshPort === "object") return this.setFormError(sshPort.error);
        const port = parsePort(form.values.port, "Backend port");
        if (typeof port === "object") return this.setFormError(port.error);
        const user = form.values.user.trim();
        const input: AddMachineInput = { host };
        if (user) input.user = user;
        if (sshPort !== undefined) input.sshPort = sshPort;
        if (port !== undefined) input.port = port;
        this.closeForm();
        this.deps.onAdd(input);
    }

    private submitRename(form: Extract<PickerForm, { kind: "rename" }>): void {
        const name = form.value.trim();
        if (!name) return this.setFormError("Enter a name.");
        this.closeForm();
        this.deps.onRename(form.id, name);
    }

    private setFormError(message: string): void {
        this.formError = message;
        this.rebuild();
    }

    private text(content: string, selected = false): TextRenderable {
        return new TextRenderable(this.deps.renderer, {
            content,
            height: 1,
            ...(selected ? SELECTED_TEXT_STYLE : {}),
        });
    }

    private rebuild(): void {
        for (const child of [...this.dialog.getChildren()]) child.destroy();
        this.input = null;
        if (this.form) this.buildForm(this.form);
        else this.buildRows();
        if (this.pending !== null) this.dialog.add(this.text(` ${this.pending}`));
        this.updateFooter();
        this.deps.renderer.requestRender();
    }

    private buildRows(): void {
        this.dialog.title = "Machines";
        for (const [index, row] of this.rows.entries()) {
            const view = this.text(rowLabel(row), index === this.selected);
            view.onMouseDown = (event) => {
                event.preventDefault();
                event.stopPropagation();
                if (this.pending !== null || this.forget) return;
                this.failure = null;
                this.selected = index;
                this.rebuild();
                if (row.kind === "add") this.openAdd();
                else this.deps.onPick(row);
            };
            this.dialog.add(view);
        }
        if (this.failure !== null) {
            this.dialog.add(
                new TextRenderable(this.deps.renderer, {
                    content: ` ${this.failure}`,
                    wrapMode: "word",
                }),
            );
        }
    }

    private buildForm(form: PickerForm): void {
        let value: string;
        let placeholder: string;
        if (form.kind === "add") {
            this.dialog.title = "Add machine";
            for (const [index, { field, label }] of ADD_FIELDS.entries()) {
                this.dialog.add(
                    this.text(` ${label}: ${form.values[field]}`, index === form.fieldIndex),
                );
            }
            const current = ADD_FIELDS[form.fieldIndex];
            value = form.values[current.field];
            placeholder = current.field === "host" ? "Enter host" : `${current.label} (optional)`;
        } else {
            this.dialog.title = `Rename ${form.name}`;
            value = form.value;
            placeholder = "Enter name";
        }
        this.input = new InputRenderable(this.deps.renderer, {
            id: "machine-picker-value",
            placeholder,
            value,
            width: "100%",
        });
        this.dialog.add(this.input);
        this.input.focus();
        if (this.formError) this.dialog.add(this.text(` ${this.formError}`));
    }

    private updateFooter(): void {
        if (this.footer && !this.footer.isDestroyed) this.footer.content = this.keyHints;
    }

    destroy(): void {
        this.forget?.destroy();
        this.forget = null;
        this.renderable.destroy();
    }
}

/**
 * Ask whether to trust a host key ssh has never seen. It opens while the picker
 * or the app already owns a keypress listener that claims every key, so the
 * dialog listens ahead of them and claims its keys first.
 */
function askTrust(renderer: CliRenderer, fingerprint: string, host: string): Promise<boolean> {
    return new Promise((resolve) => {
        const settle = (trusted: boolean): void => {
            renderer.keyInput.off("keypress", onKey);
            view.destroy();
            renderer.requestRender();
            resolve(trusted);
        };
        const view = new Confirm({
            renderer,
            title: `Trust ${host}? (y/n)`,
            message: `Unknown host key ${fingerprint}`,
            onConfirm: () => settle(true),
            onCancel: () => settle(false),
        });
        const onKey = (event: KeyEvent): void => deliverKeyToView(event, view);
        renderer.keyInput.prependListener("keypress", onKey);
        renderer.root.add(view.renderable);
        renderer.requestRender();
    });
}

export { askTrust, MachinePicker };
export type { MachinePickerDeps };
