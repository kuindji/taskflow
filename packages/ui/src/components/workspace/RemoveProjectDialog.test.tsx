import { afterEach, expect, test } from "bun:test";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { Project } from "@taskflow/shared";
import { RemoveProjectDialog } from "./RemoveProjectDialog";

// @ts-expect-error React act test flag
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const project = {
    id: "p1",
    name: "Repo",
    path: "/repo",
    sessions: [],
    attributes: [],
    createdAt: "2026-11-01T00:00:00.000Z",
    backendId: "local",
} satisfies Project & { backendId: string };

let root: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(async () => {
    await act(async () => root?.unmount());
    root = null;
    container?.remove();
    container = null;
});

test("reopening after a cancelled switch-off defaults to archiving again", async () => {
    const removed: string[] = [];
    const archived: string[] = [];
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    const render = (open: boolean) =>
        act(async () =>
            root?.render(
                <RemoveProjectDialog
                    open={open}
                    project={project}
                    onOpenChange={() => {}}
                    onRemove={(p) => removed.push(p.id)}
                    onArchive={(p) => archived.push(p.id)}
                />,
            ),
        );

    await render(true);
    await act(async () => {
        document
            .querySelector("#keep-project-data")
            ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(document.body.textContent).toContain("Permanently remove");

    // Cancel, then open again
    await render(false);
    await render(true);
    expect(document.body.textContent).toContain("Archive");
    const confirmButton = [...document.body.querySelectorAll("button")].find(
        (b) => b.textContent?.trim() === "Archive",
    );
    await act(async () => {
        confirmButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(archived).toEqual(["p1"]);
    expect(removed).toEqual([]);
});
