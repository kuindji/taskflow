import { afterAll, afterEach, beforeAll, expect, test } from "bun:test";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { Project, Task } from "@taskflow/shared";
import { MSG } from "@taskflow/shared";
import type { Scoped } from "@/lib/backend-scope";
import { closeConnection, openConnection, setPrimary } from "@/lib/connection-registry";
import { startTestServer, type TestServer } from "@/lib/test-ws-server";
import { useProjectStore } from "@/stores/project-store";
import { resetBackend } from "@/stores/store-reset";
import { useTaskStore } from "@/stores/task-store";
import { useUIStore } from "@/stores/ui-store";

import { TaskSidebar } from "@/components/sidebar/TaskSidebar";
import { Workspace } from "./Workspace";

const BACKEND = "archived-task-view";

const project: Scoped<Project> = {
    id: "p1",
    name: "Project one",
    path: "/repo/p1",
    sessions: [],
    attributes: [
        { id: "a-proj", name: "proj", value: "from-project" },
        { id: "a-shared-p", name: "shared", value: "from-project" },
    ],
    createdAt: "2026-11-01T00:00:00.000Z",
    backendId: BACKEND,
};

function task(id: string, overrides: Partial<Task> = {}): Task {
    return {
        id,
        projectId: "p1",
        title: `Title ${id}`,
        description: `Description of ${id}`,
        notes: `Notes of ${id}`,
        worktree: { enabled: false, path: null, branch: null, pr: null },
        sessions: [],
        attributes: [],
        createdAt: "2026-11-01T00:00:00.000Z",
        status: "archived",
        archivedAt: "2026-11-01T12:00:00.000Z",
        pinned: false,
        ...overrides,
    };
}

const parent = task("parent", {
    attributes: [
        { id: "a-env", name: "env", value: "from-parent" },
        { id: "a-shared-t", name: "shared", value: "from-parent" },
    ],
});
const child = task("child", {
    parentId: "parent",
    attributes: [{ id: "a-shared-c", name: "shared", value: "from-child" }],
});

let server: TestServer | null = null;
let unarchived = false;
let root: Root | null = null;

beforeAll(async () => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    server = startTestServer(BACKEND, (type) => {
        if (type === MSG.TASK_LIST_ARCHIVED) return { tasks: unarchived ? [] : [parent, child] };
        if (type === MSG.TASK_LIST) {
            return {
                tasks: unarchived
                    ? [
                          { ...parent, status: "active", archivedAt: null },
                          { ...child, status: "active", archivedAt: null },
                      ]
                    : [],
            };
        }
        if (type === MSG.TASK_UNARCHIVE) {
            unarchived = true;
            return {};
        }
        // One answer shape for every list the workspace loads on mount.
        return {
            agents: [],
            scripts: {},
            flows: [],
            actions: [],
            runs: [],
            commands: [],
            shells: [],
            systemShellPath: "/bin/sh",
        };
    });
    await openConnection(BACKEND, server.origin);
    setPrimary(BACKEND);
});

afterAll(() => {
    closeConnection(BACKEND, "detach");
    server?.stop();
});

afterEach(async () => {
    // A selection change starts the workspace's list requests; let them land
    // before the machine is detached.
    await settle();
    act(() => root?.unmount());
    root = null;
    document.body.replaceChildren();
    unarchived = false;
    // The task lists live in per-machine slices that setState does not reach.
    resetBackend(BACKEND);
    useTaskStore.setState({ tasks: [], archivedTasks: [], activeTaskId: null, showArchive: false });
    useProjectStore.setState({ projects: [] });
    useUIStore.setState({
        activeProjectId: null,
        masterWorkspaceActive: false,
        focusedPanel: "workspace",
        sidebarFocusedItem: null,
        splitByWorkspace: {},
    });
});

async function settle() {
    await act(async () => {
        await Bun.sleep(50);
    });
}

/** The sidebar in its archive view beside the workspace. */
async function renderArchive() {
    useProjectStore.setState({ projects: [project] });
    useTaskStore.setState({ showArchive: true });
    await useTaskStore.getState().fetchArchivedTasks(BACKEND);
    const container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() =>
        root?.render(
            <>
                <TaskSidebar />
                <Workspace />
            </>,
        ),
    );
    await settle();
}

function readOnlyView(): HTMLElement | null {
    const button = [...document.querySelectorAll("button")].find(
        (b) => b.textContent?.trim() === "Unarchive",
    );
    return button ?? null;
}

/** Only a live workspace's header offers the file explorer. */
function liveWorkspaceHeader(): Element | null {
    return document.querySelector('[aria-label="Show file explorer"]');
}

function notesField(): HTMLTextAreaElement | null {
    return document.querySelector<HTMLTextAreaElement>("#archived-task-notes");
}

function expectReadOnlyViewOf(t: Task) {
    expect(readOnlyView()).not.toBeNull();
    expect(notesField()?.value).toBe(t.notes);
    expect(notesField()?.readOnly).toBe(true);
    expect(liveWorkspaceHeader()).toBeNull();
    expect(document.body.textContent).not.toContain("Select a task or project");
}

test("clicking an archived task opens its read-only view", async () => {
    await renderArchive();
    const title = [...document.querySelectorAll("span, div")].find(
        (el) => el.textContent === parent.title && el.children.length === 0,
    );
    expect(title).toBeDefined();
    act(() => {
        title?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(useTaskStore.getState().activeTaskId).toBe(parent.id);
    expectReadOnlyViewOf(parent);
});

test("keyboard selection of an archived task opens the same view, not the project", async () => {
    await renderArchive();
    useUIStore.setState({
        focusedPanel: "sidebar",
        sidebarFocusedItem: { type: "project", id: project.id },
    });
    act(() => {
        window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", metaKey: true }));
    });

    expect(useTaskStore.getState().activeTaskId).toBe(parent.id);
    expectReadOnlyViewOf(parent);
});

test("task-scoped shortcuts do nothing while the view is shown", async () => {
    await renderArchive();
    act(() => {
        useTaskStore.getState().setActiveTask(parent.id);
        useUIStore.getState().setActiveProject(project.id);
    });
    await settle();
    const sent = server?.received.length ?? 0;
    act(() => {
        for (const init of [
            { key: "t", metaKey: true },
            { key: "j", metaKey: true },
            { key: "S", code: "KeyS", metaKey: true, shiftKey: true },
        ]) {
            window.dispatchEvent(new KeyboardEvent("keydown", init));
        }
    });
    await settle();

    expect(server?.received.slice(sent).map((r) => r.type)).toEqual([]);
    expect(useUIStore.getState().splitByWorkspace).toEqual({});
    expectReadOnlyViewOf(parent);
});

test("Unarchive opens the same task as a live workspace", async () => {
    await renderArchive();
    act(() => {
        useTaskStore.getState().setActiveTask(parent.id);
        useUIStore.getState().setActiveProject(project.id);
    });
    act(() => readOnlyView()?.click());
    await settle();

    expect(server?.received.some((r) => r.type === MSG.TASK_UNARCHIVE)).toBe(true);
    expect(readOnlyView()).toBeNull();
    expect(liveWorkspaceHeader()).not.toBeNull();
    expect(useTaskStore.getState().activeTaskId).toBe(parent.id);
});

test("an archived subtask of an archived parent inherits the parent's attributes", async () => {
    await renderArchive();
    act(() => {
        useTaskStore.getState().setActiveTask(child.id);
        useUIStore.getState().setActiveProject(project.id);
    });

    const text = document.body.textContent ?? "";
    expect(text).toContain("from-parent");
    expect(text).toContain("from-child");
    expect(text).toContain("proj");
    // The child's own "shared" overrides both the parent's and the project's.
    const rows = [...document.querySelectorAll("span")].filter((s) => s.textContent === "shared");
    expect(rows).toHaveLength(1);
    expect(rows[0].nextElementSibling?.textContent).toBe("from-child");
    expect(document.querySelector("input")).toBeNull();
});

test("leaving the archive view drops an archived selection", async () => {
    await renderArchive();
    act(() => {
        useTaskStore.getState().setActiveTask(parent.id);
        useUIStore.getState().setActiveProject(project.id);
    });
    act(() => useTaskStore.getState().setShowArchive(false));

    expect(useTaskStore.getState().activeTaskId).toBeNull();
    expect(readOnlyView()).toBeNull();
});
