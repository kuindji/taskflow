import { afterEach, beforeAll, expect, test } from "bun:test";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { DndContext } from "@dnd-kit/core";
import { SortableContext } from "@dnd-kit/sortable";
import { TabItem } from "./TabItem";

let root: Root | null = null;
let container: HTMLElement | null = null;

beforeAll(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
});

afterEach(() => {
    act(() => root?.unmount());
    container?.remove();
    root = null;
    container = null;
});

test("Enter and Space on the close button are left to the button, not taken by the tab", async () => {
    const selected: string[] = [];
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
        root?.render(
            <DndContext>
                <SortableContext items={["t1"]}>
                    <TabItem
                        tab={{ id: "t1", type: "shell", label: "Shell" }}
                        isActive={false}
                        index={0}
                        cmdHeld={false}
                        onTabClick={(id) => selected.push(id)}
                        onTabClose={() => {}}
                        onTabRename={() => {}}
                    />
                </SortableContext>
            </DndContext>,
        );
    });
    const closeButton = container.querySelector<HTMLButtonElement>(
        'button[aria-label="Close tab"]',
    );
    expect(closeButton).toBeTruthy();

    for (const key of ["Enter", " "]) {
        const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
        await act(async () => {
            closeButton?.dispatchEvent(event);
        });
        // A cancelled keydown stops the browser from activating (clicking) the button.
        expect(event.defaultPrevented).toBe(false);
    }
    expect(selected).toEqual([]);

    const tab = container.querySelector<HTMLElement>('[role="button"]');
    const onTab = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
    await act(async () => {
        tab?.dispatchEvent(onTab);
    });
    expect(onTab.defaultPrevented).toBe(true);
    expect(selected).toEqual(["t1"]);
});
