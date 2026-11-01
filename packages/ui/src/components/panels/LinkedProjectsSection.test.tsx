import { afterEach, expect, test } from "bun:test";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { Project } from "@taskflow/shared";
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
