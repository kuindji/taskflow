import { afterAll, beforeEach, expect, mock, test } from "bun:test";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { AgentAccount, Project } from "@taskflow/shared";
import { INHERIT_AGENT_ACCOUNT } from "@taskflow/shared";
import type { Scoped } from "@/lib/backend-scope";

// @ts-expect-error react act env flag, no upstream type for this global
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

interface MockAgentSettings {
    accounts: AgentAccount[];
}

interface MockSettings {
    claude: MockAgentSettings;
    codex: MockAgentSettings;
}

let byBackend: Record<string, MockSettings | undefined> = {};

function useSettingsStore<T>(selector: (state: { byBackend: typeof byBackend }) => T): T {
    return selector({ byBackend });
}

await mock.module("@/stores/settings-store", () => ({ useSettingsStore }));

interface ProjectUpdateForTest {
    agentAccounts?: Partial<Record<"claude" | "codex", string | null>>;
}

let updateProjectCalls: Array<{ projectId: string; updates: ProjectUpdateForTest }> = [];
let storeProjects: Scoped<Project>[] = [];

function updateProject(
    project: Scoped<Project>,
    updates: ProjectUpdateForTest,
): Promise<Scoped<Project>> {
    updateProjectCalls.push({ projectId: project.id, updates });
    return Promise.resolve(project);
}

function useProjectStore<T>(selector: (state: { updateProject: typeof updateProject }) => T): T {
    return selector({ updateProject });
}
useProjectStore.getState = () => ({ projects: storeProjects });

await mock.module("@/stores/project-store", () => ({ useProjectStore }));

// The real AgentAccountSelect renders a Radix Select, which is awkward to
// drive from happy-dom. Stand in for it with plain buttons that call
// `onChange` directly, the same way CommitDialog.test.tsx stubs
// AgentOptionsPanel -- this test cares about what this section does with a
// chosen value, not the picker's own rendering (covered by Task 9's tests).
await mock.module("@/components/shared/AgentAccountSelect", () => ({
    AgentAccountSelect: ({
        label,
        value,
        onChange,
    }: {
        label: string;
        value: string;
        onChange: (value: string) => void;
    }) => (
        <div data-testid={`account-row-${label}`}>
            <span>{`${label}: ${value}`}</span>
            <button onClick={() => onChange("acc-1")}>{`choose ${label} account`}</button>
            <button onClick={() => onChange(INHERIT_AGENT_ACCOUNT)}>
                {`choose ${label} inherit`}
            </button>
        </div>
    ),
}));

const { ProjectAgentAccountsSection } = await import("./ProjectAgentAccountsSection");

let container: HTMLDivElement;
let root: Root | null = null;

function mount(project: Scoped<Project>) {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
        root?.render(<ProjectAgentAccountsSection project={project} />);
    });
}

function unmount() {
    if (!root) return;
    const current = root;
    act(() => {
        current.unmount();
    });
    root = null;
    container.remove();
}

function click(el: Element | null | undefined) {
    if (!el) throw new Error("no element to click");
    act(() => {
        (el as HTMLElement).click();
    });
}

function button(label: string): HTMLButtonElement {
    const found = [...container.querySelectorAll("button")].find((b) => b.textContent === label);
    if (!found) throw new Error(`no button labelled ${label}`);
    return found;
}

const noAccounts: MockAgentSettings = { accounts: [] };
const someAccounts: MockAgentSettings = {
    accounts: [{ id: "acc-1", name: "personal", homeDir: "/home/personal" }],
};

function baseProject(overrides: Partial<Scoped<Project>> = {}): Scoped<Project> {
    return {
        id: "p1",
        name: "Test Project",
        path: "/tmp/p1",
        sessions: [],
        attributes: [],
        createdAt: "2026-01-01T00:00:00.000Z",
        backendId: "backend-1",
        ...overrides,
    };
}

beforeEach(() => {
    unmount();
    byBackend = {};
    storeProjects = [];
    updateProjectCalls = [];
});

afterAll(() => {
    unmount();
});

test("renders nothing when the backend has no accounts for either agent and the project has no overrides", () => {
    byBackend = { "backend-1": { claude: noAccounts, codex: noAccounts } };
    const project = baseProject();
    storeProjects = [project];

    mount(project);

    expect(container.textContent).toBe("");
});

test("renders only the agents that apply", () => {
    byBackend = { "backend-1": { claude: someAccounts, codex: noAccounts } };
    const project = baseProject();
    storeProjects = [project];

    mount(project);

    expect(container.querySelector('[data-testid="account-row-Claude"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="account-row-Codex"]')).toBeNull();
});

test("a codex row appears when the project has a codex override even with no codex accounts configured", () => {
    byBackend = { "backend-1": { claude: noAccounts, codex: noAccounts } };
    const project = baseProject({ agentAccounts: { codex: "some-account-name" } });
    storeProjects = [project];

    mount(project);

    expect(container.querySelector('[data-testid="account-row-Codex"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="account-row-Claude"]')).toBeNull();
});

test("choosing an account calls updateProject with the account id", () => {
    byBackend = { "backend-1": { claude: someAccounts, codex: noAccounts } };
    const project = baseProject();
    storeProjects = [project];

    mount(project);
    click(button("choose Claude account"));

    expect(updateProjectCalls).toEqual([
        { projectId: "p1", updates: { agentAccounts: { claude: "acc-1" } } },
    ]);
});

test('choosing "inherit" sends null, not the string', () => {
    byBackend = { "backend-1": { claude: someAccounts, codex: noAccounts } };
    const project = baseProject({ agentAccounts: { claude: "acc-1" } });
    storeProjects = [project];

    mount(project);
    click(button("choose Claude inherit"));

    expect(updateProjectCalls).toEqual([
        { projectId: "p1", updates: { agentAccounts: { claude: null } } },
    ]);
});
