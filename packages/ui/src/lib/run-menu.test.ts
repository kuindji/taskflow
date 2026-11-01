import { describe, expect, it } from "bun:test";
import type { ActionDefinition, FlowDefinition, FlowRun, FlowRunStatus } from "@taskflow/shared";
import type { NativeMenuItem } from "@/lib/native-menu";
import { buildNativeRunMenuItems, hasRunMenuItems } from "@/lib/run-menu";
import type { RunMenuCallbacks, RunMenuData } from "@/lib/run-menu";

const stamp = "2026-11-01T00:00:00.000Z";

const flow: FlowDefinition = {
    id: "flow-1",
    name: "Review",
    description: "",
    actions: [],
    createdAt: stamp,
    updatedAt: stamp,
};

function action(id: string, sessionType: ActionDefinition["sessionType"]): ActionDefinition {
    return {
        id,
        name: id,
        sessionType,
        prompt: "pwd",
        standalone: true,
        createdAt: stamp,
        updatedAt: stamp,
    };
}

function run(status: FlowRunStatus): FlowRun {
    return {
        taskId: "task-1",
        flowId: "flow-1",
        status,
        currentActionIndex: 0,
        actions: [],
        artifacts: [],
        startedAt: stamp,
    };
}

function data(overrides: Partial<RunMenuData>): RunMenuData {
    return {
        scripts: {},
        defaultRuntime: "bun",
        agentCommands: [],
        flows: [],
        standaloneActions: [],
        activeFlowRun: null,
        agents: [],
        showAgentOptions: false,
        online: true,
        ...overrides,
    };
}

const callbacks: RunMenuCallbacks = {
    onRunScript: () => {},
    onRunAgentCommand: () => {},
    onStartFlow: () => {},
    onRunAction: () => {},
};

function submenu(items: NativeMenuItem[], label: string): NativeMenuItem | undefined {
    return items.find((item) => item.label === label);
}

describe("run menu flows", () => {
    for (const status of ["completed", "failed"] as const) {
        it(`offers flows after a ${status} run`, () => {
            const menu = data({ flows: [flow], activeFlowRun: run(status) });
            const { items, actions } = buildNativeRunMenuItems(menu, callbacks);
            expect(submenu(items, "Flows")).toBeDefined();
            expect(actions["flow:flow-1"]).toBeDefined();
            expect(hasRunMenuItems(menu)).toBe(true);
        });
    }

    for (const status of ["running", "paused"] as const) {
        it(`hides flows while a run is ${status}`, () => {
            const menu = data({ flows: [flow], activeFlowRun: run(status) });
            const { items } = buildNativeRunMenuItems(menu, callbacks);
            expect(submenu(items, "Flows")).toBeUndefined();
            expect(hasRunMenuItems(menu)).toBe(false);
        });
    }
});

describe("run menu actions offline", () => {
    it("keeps shell actions runnable and disables agent actions", () => {
        const menu = data({
            online: false,
            standaloneActions: [action("shell-1", "shell"), action("agent-1", "claude")],
        });
        const { items, actions } = buildNativeRunMenuItems(menu, callbacks);
        const actionsMenu = submenu(items, "Actions");
        expect(actionsMenu?.enabled).toBe(true);
        expect(actionsMenu?.submenu?.map((item) => [item.id, item.enabled])).toEqual([
            ["action:shell-1", true],
            ["action:agent-1", false],
        ]);
        expect(actions["action:shell-1"]).toBeDefined();
        expect(actions["action:agent-1"]).toBeUndefined();
    });

    it("disables the submenu when no action can run offline", () => {
        const menu = data({ online: false, standaloneActions: [action("agent-1", "codex")] });
        const { items } = buildNativeRunMenuItems(menu, callbacks);
        expect(submenu(items, "Actions")?.enabled).toBe(false);
    });
});
