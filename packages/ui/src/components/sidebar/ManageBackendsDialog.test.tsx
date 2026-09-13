import { afterEach, expect, test } from "bun:test";
import { act } from "react";
import { createRoot } from "react-dom/client";
import type { MenuEntry } from "@taskflow/shared";
import { ManageBackendsDialog } from "./ManageBackendsDialog";

// @ts-expect-error react act env flag, no upstream type for this global
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

type Bridge = NonNullable<Window["taskflow"]>;

const originalBridge = window.taskflow;
const cleanups: (() => void)[] = [];

afterEach(() => {
    for (const cleanup of cleanups.splice(0)) cleanup();
    window.taskflow = originalBridge;
});

const desktop: MenuEntry = {
    id: "desktop-uid",
    displayName: "Desktop",
    instanceId: "main",
    host: "desktop.lan",
    attached: false,
    saved: true,
    seen: false,
    user: "me",
    sshPort: 22,
};

function typeInto(input: HTMLInputElement, value: string): void {
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    setValue?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
}

test("a cleared SSH port is refused, not saved as a no-op that leaves the row unsaved", async () => {
    const updates: string[] = [];
    const bridge: Pick<Bridge, "listBackends" | "onBackendsChanged" | "updateBackend"> = {
        listBackends: () => Promise.resolve([desktop]),
        onBackendsChanged: () => () => {},
        updateBackend: (id) => {
            updates.push(id);
            return Promise.resolve({ ok: true });
        },
    };
    window.taskflow = bridge as Bridge;

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => {
        root.render(<ManageBackendsDialog open onOpenChange={() => {}} />);
        await Bun.sleep(10);
    });
    cleanups.push(() => {
        act(() => root.unmount());
        container.remove();
    });

    const port = document.querySelector<HTMLInputElement>("input[aria-label='SSH port']");
    if (!port) throw new Error("no SSH port field");
    await act(async () => typeInto(port, ""));
    const save = [...document.querySelectorAll("button")].find((b) => b.textContent === "Save");
    await act(async () => {
        save?.click();
        await Bun.sleep(10);
    });

    expect(updates).toEqual([]);
    expect(document.body.textContent).toContain("The SSH port must be a whole number");
});
