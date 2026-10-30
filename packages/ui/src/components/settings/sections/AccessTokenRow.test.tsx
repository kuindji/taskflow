import { afterEach, expect, test } from "bun:test";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { AccessTokenRow } from "./AccessTokenRow";
// @ts-expect-error react act env flag
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const original = window.taskflow;
const cleanups: (() => void)[] = [];
afterEach(() => {
    cleanups.splice(0).forEach((fn) => fn());
    window.taskflow = original;
});
async function mount() {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => {
        root.render(<AccessTokenRow />);
        await Promise.resolve();
    });
    cleanups.push(() => {
        act(() => root.unmount());
        container.remove();
    });
    return container;
}
test("shows the first six characters and copies the full token", async () => {
    const token = "abcdef" + "a".repeat(37);
    window.taskflow = { getLocalApiToken: async () => token } as NonNullable<Window["taskflow"]>;
    const container = await mount();
    expect(container.textContent).toContain("abcdef…");
    expect(container.textContent).not.toContain(token);
    await act(async () =>
        container.querySelector<HTMLButtonElement>('button[aria-label="Copy"]')?.click(),
    );
    expect(await navigator.clipboard.readText()).toBe(token);
});
test("renders nothing without the desktop bridge or without a token", async () => {
    window.taskflow = undefined;
    expect((await mount()).textContent).toBe("");
    window.taskflow = { getLocalApiToken: async () => null } as NonNullable<Window["taskflow"]>;
    expect((await mount()).textContent).toBe("");
});
