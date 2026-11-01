import { afterEach, expect, test } from "bun:test";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { Project } from "@taskflow/shared";
import { useProjectStore } from "@/stores/project-store";
import { ForkProjectDialog } from "./ForkProjectDialog";
import { RenameProjectDialog } from "./RenameProjectDialog";

// @ts-expect-error React act test flag
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const project = {
    id: "p1",
    name: "Repo",
    path: "/work/repo",
    sessions: [],
    attributes: [],
    createdAt: "2026-11-01T00:00:00.000Z",
    backendId: "local",
} satisfies Project & { backendId: string };

let root: Root | null = null;
let container: HTMLDivElement | null = null;
const originalFork = useProjectStore.getState().forkProject;

afterEach(async () => {
    await act(async () => root?.unmount());
    root = null;
    container?.remove();
    container = null;
    useProjectStore.setState({ forkProject: originalFork });
});

async function render(node: ReactNode) {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => root?.render(node));
}

async function type(selector: string, text: string) {
    const input = document.querySelector<HTMLInputElement>(selector);
    if (!input) throw new Error(`Missing ${selector}`);
    await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(
            input,
            text,
        );
        input.dispatchEvent(new Event("input", { bubbles: true }));
    });
}

async function enter(element: Element | null | undefined) {
    if (!element) throw new Error("Missing control");
    await act(async () => {
        element.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });
}

function button(label: string) {
    return [...document.body.querySelectorAll("button")].find(
        (b) => b.textContent?.trim() === label,
    );
}

test("Enter on Fork's Cancel does not fork; Enter in the branch field does", async () => {
    const forks: string[] = [];
    useProjectStore.setState({
        forkProject: async (_project, branch, folder) => {
            forks.push(branch);
            return { branch, targetPath: `/work/${folder}`, project };
        },
    });
    await render(<ForkProjectDialog open project={project} onOpenChange={() => {}} />);
    await type("#fork-branch-name", "topic");
    await enter(button("Cancel"));
    expect(forks).toEqual([]);
    await enter(document.querySelector("#fork-branch-name"));
    expect(forks).toEqual(["topic"]);
});

test("Enter on Rename's Cancel does not rename; Enter in the name field does", async () => {
    const names: string[] = [];
    await render(
        <RenameProjectDialog
            open
            currentName="Repo"
            onOpenChange={() => {}}
            onSubmit={(name) => names.push(name)}
        />,
    );
    await type("#rename-project-name", "Other");
    await enter(button("Cancel"));
    expect(names).toEqual([]);
    await enter(document.querySelector("#rename-project-name"));
    expect(names).toEqual(["Other"]);
});
