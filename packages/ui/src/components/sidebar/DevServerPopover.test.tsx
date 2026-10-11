import { afterEach, describe, expect, test } from "bun:test";
import { act, type ReactElement } from "react";
import { createRoot } from "react-dom/client";
import type { DevServer, Project, Task } from "@taskflow/shared";
import type { Scoped } from "@/lib/backend-scope";
import { useBackendStore } from "@/stores/backend-store";
import type { MachineState } from "@/stores/backend-store";
import { useDevServerStore } from "@/stores/dev-server-store";
import type { DevServerStopState } from "@/stores/dev-server-store";
import { useProjectStore } from "@/stores/project-store";
import { useTaskStore } from "@/stores/task-store";
import { DevServerButton, DevServerList } from "./DevServerPopover";

// @ts-expect-error react act env flag, no upstream type for this global
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const originalStop = useDevServerStore.getState().stopDevServer;
const cleanups: (() => void)[] = [];

afterEach(() => {
    for (const cleanup of cleanups.splice(0)) cleanup();
    act(() => {
        useDevServerStore.setState({ devServers: [], stopStates: {}, stopDevServer: originalStop });
        useProjectStore.setState({ projects: [] });
        useTaskStore.setState({ tasks: [], archivedTasks: [] });
        useBackendStore.setState({ machines: [], primaryId: null });
    });
});

function devServer(
    backendId: string,
    id: string,
    changes: Partial<DevServer> = {},
): Scoped<DevServer> {
    return {
        id,
        pid: 4100,
        label: `server ${id}`,
        registeredAt: new Date(Date.now() - 2 * 3_600_000).toISOString(),
        projectId: "p1",
        backendId,
        ...changes,
    };
}

function machine(
    id: string,
    displayName: string,
    state: MachineState["state"] = "attached",
): MachineState {
    return {
        id,
        displayName,
        host: `${id}.lan`,
        instanceId: "main",
        state,
        isLocal: id === "local",
        keepAttached: true,
    };
}

function seed(
    devServers: Scoped<DevServer>[],
    stopStates: Record<string, DevServerStopState> = {},
) {
    act(() => {
        useProjectStore.setState({
            projects: [
                { id: "p1", name: "Taskflow", backendId: "local" },
                { id: "p1", name: "Taskflow", backendId: "laptop" },
            ] as Scoped<Project>[],
        });
        useTaskStore.setState({
            tasks: [{ id: "t1", title: "Move session", backendId: "local" }] as Scoped<Task>[],
            archivedTasks: [
                { id: "t2", title: "Old release", backendId: "local" },
            ] as Scoped<Task>[],
        });
        useBackendStore.setState({
            machines: [machine("local", "This machine"), machine("laptop", "Laptop")],
        });
        useDevServerStore.setState({ devServers, stopStates });
    });
}

async function render(element: ReactElement): Promise<HTMLElement> {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => root.render(element));
    cleanups.push(() => {
        act(() => root.unmount());
        container.remove();
    });
    return container;
}

function groupTitles(container: HTMLElement): string[] {
    return [...container.querySelectorAll("[data-dev-server-group]")].map(
        (el) => el.textContent ?? "",
    );
}

function stopButton(container: HTMLElement, label: string): HTMLButtonElement {
    const row = [...container.querySelectorAll("[data-dev-server-row]")].find((el) =>
        el.textContent?.includes(label),
    );
    const button = row?.querySelector("button");
    if (!button) throw new Error(`no stop button for ${label}`);
    return button;
}

describe("DevServerList", () => {
    test("groups by project and task on one backend, without machine names", async () => {
        seed([
            devServer("local", "1", { taskId: "t1", label: "UI dev :5173" }),
            devServer("local", "2", { label: "Docs :4000" }),
            devServer("local", "3", { taskId: "t2", label: "Archived :3000" }),
            devServer("local", "4", { projectId: "gone", taskId: "missing", label: "Lost" }),
        ]);
        const container = await render(<DevServerList />);

        expect(groupTitles(container)).toEqual([
            "Taskflow · Move session",
            "Taskflow",
            "Taskflow · Old release",
            "gone",
        ]);
        expect(container.textContent).toContain("pid 4100 · 2h ago");
    });

    test("records of deleted tasks share their project's group", async () => {
        seed([
            devServer("local", "1", { label: "Docs :4000" }),
            devServer("local", "2", { taskId: "deleted-1", label: "API :3000" }),
            devServer("local", "3", { taskId: "deleted-2", label: "UI :5173" }),
        ]);
        const container = await render(<DevServerList />);

        expect(groupTitles(container)).toEqual(["Taskflow"]);
        expect(container.querySelectorAll("[data-dev-server-row]")).toHaveLength(3);
    });

    test("hides the rows of a machine that is not attached", async () => {
        seed([
            devServer("local", "1", { label: "UI dev :5173" }),
            devServer("laptop", "1", { label: "Expo :8087" }),
        ]);
        act(() =>
            useBackendStore.setState({
                machines: [
                    machine("local", "This machine"),
                    machine("laptop", "Laptop", "offline"),
                ],
            }),
        );
        const container = await render(<DevServerList />);

        expect(container.textContent).toContain("UI dev :5173");
        expect(container.textContent).not.toContain("Expo :8087");
        // One live backend left, so no machine names.
        expect(groupTitles(container)).toEqual(["Taskflow"]);
    });

    test("shows primary's rows when primary has no machine row (browser dev renderer)", async () => {
        seed([
            devServer("local", "1", { label: "UI dev :5173" }),
            devServer("laptop", "1", { label: "Expo :8087" }),
        ]);
        act(() => useBackendStore.setState({ machines: [], primaryId: "local" }));
        const container = await render(<DevServerList />);

        expect(container.textContent).toContain("UI dev :5173");
        // A backend that is neither primary nor an attached machine stays hidden.
        expect(container.textContent).not.toContain("Expo :8087");
    });

    test("names the machine in each group when rows come from two backends", async () => {
        seed([
            devServer("local", "1", { taskId: "t1" }),
            devServer("laptop", "1", { label: "Expo :8087" }),
        ]);
        const container = await render(<DevServerList />);

        expect(groupTitles(container)).toEqual([
            "This machine · Taskflow · Move session",
            "Laptop · Taskflow",
        ]);
    });

    test("Stop asks the store to stop that row", async () => {
        const stopped: string[] = [];
        seed([devServer("local", "1", { label: "UI dev :5173" })]);
        act(() =>
            useDevServerStore.setState({
                stopDevServer: async (server) =>
                    void stopped.push(`${server.backendId}:${server.id}`),
            }),
        );
        const container = await render(<DevServerList />);

        await act(async () => stopButton(container, "UI dev :5173").click());

        expect(stopped).toEqual(["local:1"]);
    });

    test("a stopping row shows a disabled Stopping… button", async () => {
        seed([devServer("local", "1", { label: "UI dev :5173" })], { "local:1": "stopping" });
        const container = await render(<DevServerList />);

        const button = stopButton(container, "UI dev :5173");
        expect(button.textContent).toBe("Stopping…");
        expect(button.disabled).toBe(true);
    });

    test("a failed stop shows its error under the row, and a retry clears it", async () => {
        const error = "Could not stop pid 4100: operation not permitted";
        seed([devServer("local", "1", { label: "UI dev :5173" })], { "local:1": { error } });
        act(() =>
            useDevServerStore.setState({
                // What the real action does first on a retry.
                stopDevServer: async () => {
                    useDevServerStore.setState({ stopStates: { "local:1": "stopping" } });
                },
            }),
        );
        const container = await render(<DevServerList />);
        const button = stopButton(container, "UI dev :5173");
        expect(container.textContent).toContain(error);
        expect(button.textContent).toBe("Stop");
        expect(button.disabled).toBe(false);

        await act(async () => button.click());

        expect(container.textContent).not.toContain(error);
        expect(stopButton(container, "UI dev :5173").textContent).toBe("Stopping…");
    });

    test("an empty list says nothing is running", async () => {
        seed([]);
        const container = await render(<DevServerList />);

        expect(container.textContent).toContain("No dev servers running");
    });
});

describe("DevServerButton", () => {
    test("renders nothing when no server is registered", async () => {
        seed([]);
        const container = await render(<DevServerButton />);

        expect(container.querySelector('[aria-label="Dev servers"]')).toBeNull();
    });

    test("shows the icon with the count across backends", async () => {
        seed([devServer("local", "1"), devServer("laptop", "1")]);
        const container = await render(<DevServerButton />);

        const button = container.querySelector('[aria-label="Dev servers"]');
        expect(button).not.toBeNull();
        expect(button?.textContent).toBe("2");
    });

    test("counts only rows from attached machines, and hides when none are", async () => {
        seed([devServer("local", "1"), devServer("laptop", "1")]);
        act(() =>
            useBackendStore.setState({
                machines: [
                    machine("local", "This machine"),
                    machine("laptop", "Laptop", "offline"),
                ],
            }),
        );
        const container = await render(<DevServerButton />);
        expect(container.querySelector('[aria-label="Dev servers"]')?.textContent).toBe("1");

        act(() =>
            useBackendStore.setState({
                machines: [
                    machine("local", "This machine", "offline"),
                    machine("laptop", "Laptop", "offline"),
                ],
            }),
        );
        expect(container.querySelector('[aria-label="Dev servers"]')).toBeNull();
    });
});
