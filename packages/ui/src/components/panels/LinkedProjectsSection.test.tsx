import { afterEach, expect, test } from "bun:test";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { LinkedProject, Project } from "@taskflow/shared";
import type { Scoped } from "@/lib/backend-scope";
import { useProjectStore } from "@/stores/project-store";
import { LinkedProjectsSection } from "./LinkedProjectsSection";

// @ts-expect-error react act env flag, no upstream type for this global
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const project = (id: string, backendId: string): Scoped<Project> => ({
    id,
    name: id,
    path: `/repo/${id}`,
    sessions: [],
    attributes: [],
    createdAt: "2026-11-01T00:00:00.000Z",
    backendId,
});

let root: Root | null = null;
afterEach(() => {
    act(() => root?.unmount());
    root = null;
    document.body.innerHTML = "";
    useProjectStore.setState({ projects: [] });
});

async function linkButton(owner: Scoped<Project>): Promise<HTMLButtonElement> {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const mounted = createRoot(container);
    root = mounted;
    await act(async () => mounted.render(<LinkedProjectsSection project={owner} />));
    const button = container.querySelector<HTMLButtonElement>('[aria-label="Link a project"]');
    if (!button) throw new Error("Link button missing");
    return button;
}

test("a project on another machine is not offered as a link", async () => {
    const owner = project("owner", "machine-a");
    useProjectStore.setState({ projects: [owner, project("elsewhere", "machine-b")] });
    expect((await linkButton(owner)).disabled).toBe(true);
});

test("a project on the same machine is offered as a link", async () => {
    const owner = project("owner", "machine-a");
    useProjectStore.setState({
        projects: [owner, project("elsewhere", "machine-b"), project("sibling", "machine-a")],
    });
    expect((await linkButton(owner)).disabled).toBe(false);
});

/** Mounts the section with `updateProject` recorded and never answered. */
async function mountPending(owner: Scoped<Project>) {
    const sent: LinkedProject[][] = [];
    const original = useProjectStore.getState().updateProject;
    useProjectStore.setState({
        updateProject: (_target, updates) => {
            if (updates.linkedProjects) sent.push(updates.linkedProjects);
            return new Promise(() => {});
        },
    });
    restoreUpdate = () => useProjectStore.setState({ updateProject: original });
    const container = document.createElement("div");
    document.body.appendChild(container);
    const mounted = createRoot(container);
    root = mounted;
    await act(async () => mounted.render(<LinkedProjectsSection project={owner} />));
    return { container, sent };
}

let restoreUpdate: (() => void) | null = null;
afterEach(() => {
    restoreUpdate?.();
    restoreUpdate = null;
});

test("closing the panel while a removal is in flight does not restore the link", async () => {
    const owner = {
        ...project("owner", "machine-a"),
        linkedProjects: [{ projectId: "linked", note: "Shared API" }],
    };
    useProjectStore.setState({ projects: [owner, project("linked", "machine-a")] });
    const { container, sent } = await mountPending(owner);

    const remove = container.querySelector<HTMLButtonElement>(
        '[aria-label="Remove linked project"]',
    );
    await act(async () => remove?.click());
    act(() => root?.unmount());
    root = null;

    expect(sent).toEqual([[]]);
});

test("a note edit while an added link is in flight keeps the added link", async () => {
    const owner = {
        ...project("owner", "machine-a"),
        linkedProjects: [{ projectId: "linked", note: "" }],
    };
    useProjectStore.setState({
        projects: [owner, project("linked", "machine-a"), project("sibling", "machine-a")],
    });
    const { container, sent } = await mountPending(owner);

    await act(async () =>
        container.querySelector<HTMLButtonElement>('[aria-label="Link a project"]')?.click(),
    );
    const option = [...document.querySelectorAll<HTMLButtonElement>("button")].find(
        (b) => b.textContent === "sibling",
    );
    await act(async () => option?.click());

    const input = container.querySelector<HTMLInputElement>("input");
    if (!input) throw new Error("note input missing");
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    await act(async () => {
        setValue?.call(input, "Shared API");
        input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(() => new Promise((resolve) => setTimeout(resolve, 450)));

    expect(sent.at(-1)).toEqual([
        { projectId: "linked", note: "Shared API" },
        { projectId: "sibling", note: "" },
    ]);
});

test("a note changed elsewhere is shown and not overwritten by the next note edit", async () => {
    const owner = {
        ...project("owner", "machine-a"),
        linkedProjects: [
            { projectId: "alpha", note: "A" },
            { projectId: "beta", note: "B old" },
        ],
    };
    useProjectStore.setState({
        projects: [owner, project("alpha", "machine-a"), project("beta", "machine-a")],
    });
    const { container, sent } = await mountPending(owner);

    const updated = {
        ...owner,
        linkedProjects: [
            { projectId: "alpha", note: "A" },
            { projectId: "beta", note: "B new" },
        ],
    };
    await act(async () => root?.render(<LinkedProjectsSection project={updated} />));
    const inputs = container.querySelectorAll<HTMLInputElement>("input");
    expect(inputs[1]?.value).toBe("B new");

    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    await act(async () => {
        setValue?.call(inputs[0], "A edited");
        inputs[0]?.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(() => new Promise((resolve) => setTimeout(resolve, 450)));

    expect(sent.at(-1)).toEqual([
        { projectId: "alpha", note: "A edited" },
        { projectId: "beta", note: "B new" },
    ]);
});
