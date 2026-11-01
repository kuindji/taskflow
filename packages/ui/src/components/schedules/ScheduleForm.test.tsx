import { afterEach, expect, test } from "bun:test";
import { act } from "react";
import { createRoot } from "react-dom/client";
import type { ActionDefinition, Project, Schedule } from "@taskflow/shared";
import type { Scoped } from "@/lib/backend-scope";
import { ScheduleForm } from "./ScheduleForm";

// @ts-expect-error react act env flag, no upstream type for this global
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const cleanups: (() => void)[] = [];

afterEach(() => {
    for (const cleanup of cleanups.splice(0)) cleanup();
});

const project: Scoped<Project> = {
    id: "p1",
    name: "Repo",
    path: "/repo",
    sessions: [],
    attributes: [],
    createdAt: "",
    backendId: "b1",
};

const action: Scoped<ActionDefinition> = {
    id: "a1",
    name: "Build",
    prompt: "build it",
    sessionType: "claude",
    standalone: true,
    createdAt: "",
    updatedAt: "",
    backendId: "b1",
};

// Switched from a custom prompt to an action: the backend keeps the old prompt.
const schedule: Schedule = {
    id: "s1",
    projectId: "p1",
    name: "Nightly",
    actionId: "a1",
    prompt: "old prompt",
    expression: "rate(30 minutes)",
    expressionType: "rate",
    enabled: true,
    timeout: 30,
    lastRunAt: null,
    lastError: null,
    nextRunAt: null,
    runningSessionId: null,
    createdAt: "",
    updatedAt: "",
};

test("a schedule opened before the actions load keeps its action", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    cleanups.push(() => {
        act(() => root.unmount());
        container.remove();
    });
    const render = (actions: Scoped<ActionDefinition>[]) =>
        root.render(
            <ScheduleForm
                schedule={schedule}
                projects={[project]}
                actions={actions}
                onSave={() => Promise.resolve()}
                onCancel={() => {}}
            />,
        );

    await act(async () => {
        render([]);
        await Bun.sleep(10);
    });
    await act(async () => {
        render([action]);
        await Bun.sleep(10);
    });

    expect(container.textContent).toContain("Action: Build");
    expect(container.textContent).not.toContain("old prompt");
});
