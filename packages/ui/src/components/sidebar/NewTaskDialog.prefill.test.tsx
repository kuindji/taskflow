import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { Project } from "@taskflow/shared";
import type { DroppedTask } from "@/lib/dropped-task";

// The description field is an ExpandableTextarea, which imports the monaco
// editor dialog, which loads monaco at import time. Monaco attaches
// document-level listeners that throw on any synthetic click, and bun shares one
// document across test files — so leaving it in breaks whichever component test
// runs next, not this one. `FlowEditor.loop.test.tsx` stubs its own route to
// monaco for the same reason; this is the other route in.
await mock.module("@/components/ui/monaco-editor-dialog", () => ({
    MonacoEditorDialog: () => null,
}));

const { NewTaskDialog } = await import("./NewTaskDialog");

// @ts-expect-error react act env flag, no upstream type for this global
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function project(id: string): Project {
    return {
        id,
        name: id,
        path: `/tmp/${id}`,
        sessions: [],
        attributes: [],
        createdAt: "2026-08-31T00:00:00.000Z",
    };
}

let container: HTMLDivElement;
let root: Root;

function render(open: boolean, prefill?: DroppedTask | null) {
    act(() => {
        root.render(
            <NewTaskDialog
                open={open}
                onOpenChange={() => {}}
                projects={[project("web")]}
                flows={[]}
                defaultProjectId="web"
                prefill={prefill}
                onSubmit={() => {}}
            />,
        );
    });
}

/** The dialog portals out of the container, so fields are looked up globally. */
function field(id: string): HTMLInputElement | HTMLTextAreaElement {
    const element = document.getElementById(id);
    if (!element) throw new Error(`no #${id} in the rendered dialog`);
    return element as HTMLInputElement | HTMLTextAreaElement;
}

beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    act(() => {
        root = createRoot(container);
    });
});

afterEach(() => {
    act(() => root.unmount());
    container.remove();
});

describe("new task dialog prefill", () => {
    it("seeds both fields when a drop opens it", () => {
        render(false, null);
        render(true, { title: "Checkout redesign", description: "Rip out the modal." });

        expect(field("new-task-title").value).toBe("Checkout redesign");
        expect(field("new-task-description").value).toBe("Rip out the modal.");
    });

    // Text dragged in from anywhere but TaskTray has no title to give, and the
    // user types one. The description alone is enough to submit.
    it("leaves the title empty when the drop carried only a description", () => {
        render(false, null);
        render(true, { description: "Rewrite the onboarding email." });

        expect(field("new-task-title").value).toBe("");
        expect(field("new-task-description").value).toBe("Rewrite the onboarding email.");
    });

    // The seeding effect keys off the closed -> open edge for this reason: a
    // re-render while the dialog is open must not overwrite what has been typed.
    it("does not overwrite an edit when it re-renders with the same prefill", () => {
        const prefill = { title: "Checkout redesign", description: "Rip out the modal." };
        render(false, null);
        render(true, prefill);

        const description = field("new-task-description");
        act(() => {
            const setter = Object.getOwnPropertyDescriptor(
                HTMLTextAreaElement.prototype,
                "value",
            )?.set;
            setter?.call(description, "Edited by hand.");
            description.dispatchEvent(new Event("input", { bubbles: true }));
        });
        expect(field("new-task-description").value).toBe("Edited by hand.");

        // A new object with equal contents — what a parent re-render produces.
        render(true, { ...prefill });

        expect(field("new-task-description").value).toBe("Edited by hand.");
    });

    it("opens empty when nothing was dropped", () => {
        render(false, null);
        render(true, null);

        expect(field("new-task-title").value).toBe("");
        expect(field("new-task-description").value).toBe("");
    });
});
