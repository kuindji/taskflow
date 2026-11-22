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

for (const withAction of [false, true]) {
    test(`saves and clears a condition with ${withAction ? "an action" : "a custom prompt"}`, async () => {
        const saved: unknown[] = [];
        const container = document.createElement("div");
        document.body.appendChild(container);
        const root = createRoot(container);
        // React handles clicks at this root. Keep synthetic clicks away from
        // Monaco's document-level Safari clipboard listener in happy-dom.
        container.addEventListener("click", (event) => event.stopPropagation());
        cleanups.push(() => {
            act(() => root.unmount());
            container.remove();
        });
        await act(async () => {
            root.render(
                <ScheduleForm
                    schedule={{
                        ...schedule,
                        actionId: withAction ? action.id : undefined,
                        conditionScript: "test -s inbox",
                    }}
                    projects={[project]}
                    actions={[action]}
                    onSave={(payload) => {
                        saved.push(payload);
                        return Promise.resolve();
                    }}
                    onCancel={() => {}}
                />,
            );
        });
        const textarea = container.querySelector<HTMLTextAreaElement>("#schedule-condition");
        const saveButton = [...container.querySelectorAll("button")].find(
            (b) => b.textContent === "Save",
        );
        if (!textarea || !saveButton) throw new Error("Missing condition field or save button");
        expect(textarea.value).toBe("test -s inbox");
        expect(saveButton.disabled).toBe(true);
        const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
        for (const value of ["python3 scripts/check.py", ""]) {
            await act(async () => {
                setter?.call(textarea, value);
                textarea.dispatchEvent(new Event("input", { bubbles: true }));
            });
            expect(saveButton.disabled).toBe(false);
            await act(async () => {
                saveButton.click();
            });
            expect(saved.at(-1)).toMatchObject({
                id: schedule.id,
                projectId: schedule.projectId,
                conditionScript: value || null,
                actionId: withAction ? action.id : null,
            });
        }
    });
}

async function chooseSelectOption(trigger: HTMLElement, optionText: string) {
    await act(async () => {
        trigger.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
        await Bun.sleep(10);
    });
    const option = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find(
        (o) => o.textContent === optionText,
    );
    if (!option) throw new Error(`Missing option "${optionText}"`);
    await act(async () => {
        option.focus();
        option.dispatchEvent(
            new PointerEvent("pointermove", { bubbles: true, pointerType: "mouse" }),
        );
        option.dispatchEvent(
            new PointerEvent("pointerup", { bubbles: true, button: 0, pointerType: "mouse" }),
        );
        await Bun.sleep(10);
    });
}

test("allows editing a schedule's project and reassigning from an archived project", async () => {
    const archivedProject: Scoped<Project> = {
        ...project,
        id: "p-archived",
        name: "Archived Repo",
        path: "/archived",
        hidden: true,
    };
    const otherProject: Scoped<Project> = {
        ...project,
        id: "p2",
        name: "Other Repo",
        path: "/other",
    };
    const saved: unknown[] = [];
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    container.addEventListener("click", (event) => event.stopPropagation());
    container.addEventListener("keydown", (event) => event.stopPropagation());
    cleanups.push(() => {
        act(() => root.unmount());
        container.remove();
    });

    await act(async () => {
        root.render(
            <ScheduleForm
                schedule={{
                    ...schedule,
                    projectId: archivedProject.id,
                    actionId: undefined,
                    prompt: "check repo",
                }}
                projects={[archivedProject, otherProject]}
                actions={[]}
                onSave={(payload) => {
                    saved.push(payload);
                    return Promise.resolve();
                }}
                onCancel={() => {}}
            />,
        );
    });

    const projectTrigger = container.querySelector<HTMLElement>("#schedule-project");
    const saveButton = [...container.querySelectorAll("button")].find(
        (b) => b.textContent === "Save",
    );
    if (!projectTrigger || !saveButton) throw new Error("Missing project trigger or save button");

    expect(projectTrigger.textContent).toContain("Archived Repo");
    expect(saveButton.disabled).toBe(true);

    await chooseSelectOption(projectTrigger, "Other Repo");
    expect(projectTrigger.textContent).toContain("Other Repo");
    expect(saveButton.disabled).toBe(false);

    await act(async () => {
        saveButton.click();
    });

    expect(saved.at(-1)).toMatchObject({
        id: schedule.id,
        projectId: "p2",
    });
});

test("changing project drops an action scoped to the previous project on save", async () => {
    const otherProject: Scoped<Project> = {
        ...project,
        id: "p2",
        name: "Other Repo",
        path: "/other",
    };
    const projectAction: Scoped<ActionDefinition> = {
        ...action,
        id: "a-p1",
        projectId: "p1",
        name: "Repo Only",
    };
    const saved: unknown[] = [];
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    container.addEventListener("click", (event) => event.stopPropagation());
    container.addEventListener("keydown", (event) => event.stopPropagation());
    cleanups.push(() => {
        act(() => root.unmount());
        container.remove();
    });

    await act(async () => {
        root.render(
            <ScheduleForm
                schedule={{
                    ...schedule,
                    projectId: "p1",
                    actionId: projectAction.id,
                    prompt: "fallback prompt",
                }}
                projects={[project, otherProject]}
                actions={[projectAction]}
                onSave={(payload) => {
                    saved.push(payload);
                    return Promise.resolve();
                }}
                onCancel={() => {}}
            />,
        );
    });

    const projectTrigger = container.querySelector<HTMLElement>("#schedule-project");
    const saveButton = [...container.querySelectorAll("button")].find(
        (b) => b.textContent === "Save",
    );
    if (!projectTrigger || !saveButton) throw new Error("Missing project trigger or save button");

    expect(container.textContent).toContain("Action: Repo Only");

    await chooseSelectOption(projectTrigger, "Other Repo");
    expect(container.textContent).not.toContain("Action: Repo Only");
    expect(saveButton.disabled).toBe(false);

    await act(async () => {
        saveButton.click();
    });

    expect(saved.at(-1)).toMatchObject({
        id: schedule.id,
        projectId: "p2",
        actionId: null,
        prompt: "fallback prompt",
    });
});
