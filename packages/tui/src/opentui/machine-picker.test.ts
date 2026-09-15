import { afterEach, describe, expect, it } from "bun:test";
import { KeyEvent } from "@opentui/core";
import { createTestRenderer } from "@opentui/core/testing";
import type { MenuEntry } from "@taskflow/shared";
import type { PickerRow } from "../remote/picker-model";
import { askTrust, MachinePicker } from "./machine-picker";

function key(name: string, sequence = name, shift = false): KeyEvent {
    return new KeyEvent({
        name,
        sequence,
        raw: sequence,
        eventType: "press",
        source: "raw",
        ctrl: false,
        meta: false,
        shift,
        option: false,
        number: false,
    });
}

function typeText(picker: MachinePicker, text: string): void {
    for (const char of text) picker.handleKey(key(char, char));
}

function entry(overrides: Partial<MenuEntry> & { id: string }): MenuEntry {
    return {
        displayName: overrides.id,
        instanceId: "main",
        host: `${overrides.id}.lan`,
        attached: false,
        saved: true,
        seen: true,
        ...overrides,
    };
}

const saved = entry({ id: "desk", displayName: "Desk" });
const unseen = entry({ id: "laptop", displayName: "Laptop", seen: false });
const discovered = entry({ id: "10.0.0.9:main", displayName: "studio", saved: false });

describe("MachinePicker", () => {
    const cleanups: Array<() => void> = [];
    afterEach(() => cleanups.splice(0).forEach((cleanup) => cleanup()));

    async function setup(
        options: { lastMachineId?: string | null; mode?: "launch" | "switch" } = {},
    ) {
        const test = await createTestRenderer({ width: 100, height: 30 });
        const picked: PickerRow[] = [];
        const added: Array<{ host: string; user?: string; sshPort?: number; port?: number }> = [];
        const renamed: Array<[string, string]> = [];
        const forgotten: string[] = [];
        let cancelled = 0;
        const picker = new MachinePicker({
            renderer: test.renderer,
            // Discovered first on purpose: the picker orders rows, not the caller.
            entries: [discovered, unseen, saved],
            lastMachineId: options.lastMachineId ?? null,
            mode: options.mode ?? "launch",
            onPick: (row) => picked.push(row),
            onAdd: (input) => added.push(input),
            onRename: (id, name) => renamed.push([id, name]),
            onForget: (id) => forgotten.push(id),
            onCancel: () => cancelled++,
        });
        test.renderer.root.add(picker.renderable);
        cleanups.push(
            () => picker.destroy(),
            () => test.renderer.destroy(),
        );
        const frame = async (): Promise<string> => {
            await test.renderOnce();
            return test.captureCharFrame();
        };
        return {
            test,
            picker,
            frame,
            picked,
            added,
            renamed,
            forgotten,
            cancelled: () => cancelled,
        };
    }

    it("renders local, saved, discovered and add rows in model order", async () => {
        const { frame } = await setup();
        const text = await frame();
        const positions = ["This machine", "Desk", "Laptop", "studio", "Add machine"].map((label) =>
            text.indexOf(label),
        );
        for (const position of positions) expect(position).toBeGreaterThanOrEqual(0);
        expect([...positions].sort((a, b) => a - b)).toEqual(positions);
    });

    it("Enter on the preselected row picks it", async () => {
        const { picker, picked } = await setup({ lastMachineId: "laptop" });
        picker.handleKey(key("return", "\r"));
        expect(picked).toEqual([{ kind: "machine", entry: unseen }]);
    });

    it("moves with j/k and arrows and picks local when nothing was used before", async () => {
        const { picker, picked } = await setup();
        picker.handleKey(key("return", "\r"));
        picker.handleKey(key("j", "j"));
        picker.handleKey(key("down"));
        picker.handleKey(key("k", "k"));
        picker.handleKey(key("return", "\r"));
        expect(picked).toEqual([{ kind: "local" }, { kind: "machine", entry: saved }]);
    });

    it("Esc cancels in both modes and names the action in the hints", async () => {
        const launch = await setup({ mode: "launch" });
        expect(launch.picker.keyHints).toContain("Esc Quit");
        launch.picker.handleKey(key("escape", "\x1b"));
        expect(launch.cancelled()).toBe(1);

        const switching = await setup({ mode: "switch" });
        expect(switching.picker.keyHints).toContain("Esc Close");
        switching.picker.handleKey(key("escape", "\x1b"));
        expect(switching.cancelled()).toBe(1);
    });

    it("the add form rejects an empty host without calling onAdd", async () => {
        const { picker, frame, added } = await setup();
        picker.handleKey(key("a", "a"));
        typeText(picker, "   ");
        picker.handleKey(key("return", "\r"));
        expect(added).toEqual([]);
        expect(await frame()).toContain("Enter a host name or address.");
    });

    it("the add form parses numeric ports and leaves empty fields out", async () => {
        const { picker, added } = await setup();
        picker.handleKey(key("a", "a"));
        typeText(picker, "vpn-box");
        picker.handleKey(key("down"));
        picker.handleKey(key("down"));
        typeText(picker, "2222");
        picker.handleKey(key("down"));
        typeText(picker, "7777");
        picker.handleKey(key("return", "\r"));
        expect(added).toEqual([{ host: "vpn-box", sshPort: 2222, port: 7777 }]);
    });

    it("the add form rejects a port that is not a number", async () => {
        const { picker, frame, added } = await setup();
        picker.handleKey(key("a", "a"));
        typeText(picker, "vpn-box");
        picker.handleKey(key("down"));
        picker.handleKey(key("down"));
        typeText(picker, "22x");
        picker.handleKey(key("return", "\r"));
        expect(added).toEqual([]);
        expect(await frame()).toContain("SSH port must be a number from 1 to 65535.");
    });

    it("Enter on the add row opens the form instead of picking", async () => {
        const { picker, frame, picked } = await setup();
        for (let i = 0; i < 4; i++) picker.handleKey(key("down"));
        picker.handleKey(key("return", "\r"));
        expect(picked).toEqual([]);
        expect(await frame()).toContain("Host:");
    });

    it("renames a saved row", async () => {
        const { picker, renamed } = await setup({ lastMachineId: "desk" });
        picker.handleKey(key("r", "R", true));
        // The form starts with the current name; clear it before typing.
        for (let i = 0; i < "Desk".length; i++) picker.handleKey(key("backspace", "\b"));
        typeText(picker, "Office");
        picker.handleKey(key("return", "\r"));
        expect(renamed).toEqual([["desk", "Office"]]);
    });

    it("forgets a saved row after confirmation", async () => {
        const { picker, frame, forgotten } = await setup({ lastMachineId: "desk" });
        picker.handleKey(key("f", "F", true));
        expect(await frame()).toContain("Forget Desk");
        picker.handleKey(key("y", "y"));
        expect(forgotten).toEqual(["desk"]);
    });

    it("ignores R and F on local, add and unsaved rows", async () => {
        const { picker, frame, renamed, forgotten, picked } = await setup();
        // local (row 0), discovered (row 3), add (row 4)
        for (const moves of [0, 3, 1]) {
            for (let i = 0; i < moves; i++) picker.handleKey(key("down"));
            picker.handleKey(key("r", "R", true));
            picker.handleKey(key("f", "F", true));
            // Neither the rename form nor the forget confirmation opened.
            expect(picker.keyHints).toContain("Enter");
            expect(picker.keyHints).not.toContain("Save");
            expect(picker.keyHints).not.toContain("Confirm");
            const text = await frame();
            expect(text).not.toContain("Rename ");
            expect(text).not.toContain("Forget studio");
        }
        expect(renamed).toEqual([]);
        expect(forgotten).toEqual([]);
        expect(picked).toEqual([]);
    });

    it("shows a failure until the next key", async () => {
        const { picker, frame } = await setup();
        picker.showFailure("ssh refused the connection.");
        expect(await frame()).toContain("ssh refused the connection.");
        picker.handleKey(key("j", "j"));
        expect(await frame()).not.toContain("ssh refused the connection.");
    });

    it("keeps the selected machine when entries refresh", async () => {
        const { picker, picked } = await setup({ lastMachineId: "laptop" });
        const newcomer = entry({ id: "aaa", displayName: "Aardvark" });
        picker.setEntries([newcomer, saved, unseen, discovered]);
        picker.handleKey(key("return", "\r"));
        expect(picked).toEqual([{ kind: "machine", entry: unseen }]);
    });
});

describe("askTrust", () => {
    const cleanups: Array<() => void> = [];
    afterEach(() => cleanups.splice(0).forEach((cleanup) => cleanup()));

    async function ask() {
        const test = await createTestRenderer({ width: 100, height: 30 });
        cleanups.push(() => test.renderer.destroy());
        const answer = askTrust(test.renderer, "SHA256:abc123", "desk.lan");
        await test.renderOnce();
        return { test, answer, text: test.captureCharFrame() };
    }

    it("shows the fingerprint and resolves true on y", async () => {
        const { test, answer, text } = await ask();
        expect(text).toContain("desk.lan");
        expect(text).toContain("SHA256:abc123");
        test.renderer.keyInput.emit("keypress", key("y", "y"));
        expect(await answer).toBe(true);
        await test.renderOnce();
        expect(test.captureCharFrame()).not.toContain("SHA256:abc123");
    });

    it("resolves false on Esc", async () => {
        const { test, answer } = await ask();
        test.renderer.keyInput.emit("keypress", key("escape", "\x1b"));
        expect(await answer).toBe(false);
    });
});
