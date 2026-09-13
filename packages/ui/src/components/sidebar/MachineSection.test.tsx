import { afterEach, expect, test } from "bun:test";
import { act } from "react";
import { createRoot } from "react-dom/client";
import type { Project } from "@taskflow/shared";
import type { Scoped } from "@/lib/backend-scope";
import { useBackendStore } from "@/stores/backend-store";
import type { MachineState } from "@/stores/backend-store";
import { MachineSection } from "./MachineSection";

// @ts-expect-error react act env flag, no upstream type for this global
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const originalRetry = useBackendStore.getState().retry;
const cleanups: (() => void)[] = [];

afterEach(() => {
    for (const cleanup of cleanups.splice(0)) cleanup();
    useBackendStore.setState({ machines: [], retry: originalRetry });
});

function machine(changes: Partial<MachineState> = {}): MachineState {
    return {
        id: "laptop-uid",
        displayName: "Laptop",
        host: "laptop.lan",
        instanceId: "main",
        state: "attached",
        isLocal: false,
        keepAttached: true,
        ...changes,
    };
}

const projects = [
    { id: "p1", name: "Alpha", backendId: "laptop-uid" },
    { id: "p2", name: "Beta", backendId: "laptop-uid" },
] as Scoped<Project>[];

async function render(row: MachineState): Promise<HTMLElement> {
    act(() => useBackendStore.setState((state) => ({ machines: [...state.machines, row] })));
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () =>
        root.render(
            <MachineSection
                machine={row}
                projects={projects}
                open
                onOpenChange={() => {}}
                renderProjects={(list) => (
                    <ul>
                        {list.map((p) => (
                            <li key={p.id}>{p.name}</li>
                        ))}
                    </ul>
                )}
            />,
        ),
    );
    cleanups.push(() => {
        act(() => root.unmount());
        container.remove();
    });
    return container;
}

test("an attached machine renders its name and every project", async () => {
    const container = await render(machine());
    expect(container.textContent).toContain("Laptop");
    expect([...container.querySelectorAll("li")].map((li) => li.textContent)).toEqual([
        "Alpha",
        "Beta",
    ]);
});

test("an offline machine shows why and a retry, and no projects", async () => {
    const retried: string[] = [];
    useBackendStore.setState({ retry: (id) => void retried.push(id) });
    const container = await render(
        machine({
            state: "offline",
            failure: { kind: "no-route", message: "Host unreachable", stderr: "" },
        }),
    );
    expect(container.textContent).toContain("Laptop");
    expect(container.textContent).toContain("Host unreachable");
    expect(container.querySelectorAll("li")).toHaveLength(0);

    const retry = [...container.querySelectorAll("button")].find(
        (button) => button.textContent === "Retry",
    );
    await act(async () => retry?.click());
    expect(retried).toEqual(["laptop-uid"]);
});

test("an incompatible machine says it needs an update and shows no projects", async () => {
    const container = await render(machine({ state: "incompatible" }));
    expect(container.textContent).toContain("needs update");
    expect(container.querySelectorAll("li")).toHaveLength(0);
});

test("a connecting machine says so and shows no projects", async () => {
    const container = await render(machine({ state: "attaching" }));
    expect(container.textContent).toContain("connecting");
    expect(container.querySelectorAll("li")).toHaveLength(0);
});

test("the local machine renders its projects with no header", async () => {
    const container = await render(machine({ isLocal: true, displayName: "This machine" }));
    expect(container.textContent).not.toContain("This machine");
    expect(container.querySelectorAll("button")).toHaveLength(0);
    expect(container.querySelectorAll("li")).toHaveLength(2);
});

test("the instance is named only when its host runs another one", async () => {
    const alone = await render(machine({ instanceId: "dev-feature" }));
    expect(alone.textContent).not.toContain("dev-feature");

    act(() => useBackendStore.setState({ machines: [machine({ id: "laptop-main" })] }));
    const shared = await render(machine({ instanceId: "dev-feature" }));
    expect(shared.textContent).toContain("dev-feature");
});
