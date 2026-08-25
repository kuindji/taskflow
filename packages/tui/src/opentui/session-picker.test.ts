import { afterEach, describe, expect, it } from "bun:test";
import { KeyEvent } from "@opentui/core";
import { createTestRenderer } from "@opentui/core/testing";
import { SessionPicker } from "./session-picker";
import type { SessionPickerItem } from "../sessions/create-model";

const items: SessionPickerItem[] = [
    {
        kind: "agent",
        type: "codex",
        label: "Codex",
        isDefault: true,
        agentOptions: {
            type: "codex",
            sandbox: "workspace-write",
            approvalPolicy: "on-request",
            dangerouslyBypassApprovalsAndSandbox: false,
        },
    },
    { kind: "shell", type: "shell", label: "zsh", path: "/bin/zsh", isDefault: true },
];

function key(name: string, sequence = name): KeyEvent {
    return new KeyEvent({
        name,
        sequence,
        raw: sequence,
        eventType: "press",
        source: "raw",
        ctrl: false,
        meta: false,
        shift: false,
        option: false,
        number: false,
    });
}

describe("SessionPicker", () => {
    const cleanups: Array<() => void> = [];
    afterEach(() => cleanups.splice(0).forEach((cleanup) => cleanup()));

    async function setup() {
        const test = await createTestRenderer({ width: 80, height: 24 });
        const submitted: SessionPickerItem[] = [];
        let cancelled = 0;
        const picker = new SessionPicker({
            renderer: test.renderer,
            onCancel: () => cancelled++,
            onSubmit: (item) => submitted.push(item),
        });
        test.renderer.root.add(picker.renderable);
        cleanups.push(
            () => picker.destroy(),
            () => test.renderer.destroy(),
        );
        return { test, picker, submitted, cancelled: () => cancelled };
    }

    it("renders loading, items, defaults, and errors", async () => {
        const { test, picker } = await setup();
        await test.renderOnce();
        expect(test.captureCharFrame()).toContain("Loading...");
        expect(picker.keyHints).toBe(" Esc Cancel");
        picker.setItems(items);
        expect(picker.keyHints).toContain("Enter Start");
        await test.renderOnce();
        expect(test.captureCharFrame()).toContain("Agent: Codex (default)");
        expect(test.captureCharFrame()).toContain("Shell: zsh (default)");
        picker.setError("Backend unavailable");
        await test.renderOnce();
        expect(test.captureCharFrame()).toContain("Backend unavailable");
    });

    it("supports j, arrows, Enter, Escape, and pending suppression", async () => {
        const { picker, submitted, cancelled } = await setup();
        picker.setItems(items);
        picker.handleKey(key("j", "j"));
        picker.handleKey(key("return", "\r"));
        expect(submitted).toEqual([items[1]]);
        picker.setPending(true);
        picker.handleKey(key("return", "\r"));
        expect(submitted).toHaveLength(1);
        picker.handleKey(key("escape", "\x1b"));
        expect(cancelled()).toBe(0);
        picker.setPending(false);
        picker.handleKey(key("escape", "\x1b"));
        expect(cancelled()).toBe(1);
    });
});
