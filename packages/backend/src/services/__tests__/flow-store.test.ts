import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, writeFile } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { FlowStore } from "../flow-store";

let tempDir: string;
let store: FlowStore;

beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "flow-store-test-"));
    store = new FlowStore(join(tempDir, "flows"), join(tempDir, "flow-runs"));
    await store.init();
});

afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
});

describe("action definitions", () => {
    test("saveAction and getActions round-trips", async () => {
        const action = {
            id: "action-1",
            name: "Planning",
            prompt: "Write a plan",
            sessionType: "claude" as const,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
        };
        await store.saveAction(action);
        const actions = await store.getActions();
        expect(actions).toHaveLength(1);
        expect(actions[0].name).toBe("Planning");
    });

    test("saveAction updates existing action", async () => {
        const action = {
            id: "action-1",
            name: "Planning",
            prompt: "Write a plan",
            sessionType: "claude" as const,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
        };
        await store.saveAction(action);
        await store.saveAction({ ...action, name: "Planning v2" });
        const actions = await store.getActions();
        expect(actions).toHaveLength(1);
        expect(actions[0].name).toBe("Planning v2");
    });

    test("deleteAction removes an unreferenced action", async () => {
        const action = {
            id: "action-1",
            name: "Planning",
            prompt: "Write a plan",
            sessionType: "claude" as const,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
        };
        await store.saveAction(action);
        await store.deleteAction("action-1");
        const actions = await store.getActions();
        expect(actions).toHaveLength(0);
    });

    test("deleteAction rejects a referenced action", async () => {
        const action = {
            id: "action-1",
            name: "Planning",
            prompt: "Write a plan",
            sessionType: "claude" as const,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
        };
        const flow = {
            id: "flow-1",
            name: "Feature Dev",
            description: "test",
            actions: [{ id: "entry-1", actionId: "action-1" }],
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
        };

        await store.saveAction(action);
        await store.saveFlow(flow);

        expect(store.deleteAction("action-1")).rejects.toThrow(
            'Cannot delete action "action-1" because it is used by: Feature Dev',
        );
        expect(store.getActions()).resolves.toHaveLength(1);
    });

    test("getFlowsReferencingAction returns flows that use an action", async () => {
        const action = {
            id: "action-1",
            name: "Planning",
            prompt: "Write a plan",
            sessionType: "claude" as const,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
        };
        const flow = {
            id: "flow-1",
            name: "Feature Dev",
            description: "test",
            actions: [{ id: "entry-1", actionId: "action-1" }],
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
        };
        await store.saveAction(action);
        await store.saveFlow(flow);

        const referencing = await store.getFlowsReferencingAction("action-1");
        expect(referencing.map((entry) => entry.id)).toEqual(["flow-1"]);
    });

    test("getActions rethrows malformed JSON", async () => {
        await writeFile(join(tempDir, "flows", "actions.json"), "{bad json");

        expect(store.getActions()).rejects.toThrow();
    });
});

describe("flow definitions", () => {
    test("saveFlow and getFlows round-trips", async () => {
        const flow = {
            id: "flow-1",
            name: "Feature Dev",
            description: "Full feature lifecycle",
            actions: [
                {
                    id: "entry-1",
                    inline: {
                        name: "Plan",
                        prompt: "Plan it",
                        sessionType: "claude" as const,
                    },
                },
            ],
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
        };
        await store.saveFlow(flow);
        const flows = await store.getFlows();
        expect(flows).toHaveLength(1);
        expect(flows[0].name).toBe("Feature Dev");
    });

    test("deleteFlow removes flow", async () => {
        const flow = {
            id: "flow-1",
            name: "Feature Dev",
            description: "test",
            actions: [
                {
                    id: "entry-1",
                    inline: {
                        name: "Plan",
                        prompt: "Plan it",
                        sessionType: "claude" as const,
                    },
                },
            ],
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
        };
        await store.saveFlow(flow);
        await store.deleteFlow("flow-1");
        const flows = await store.getFlows();
        expect(flows).toHaveLength(0);
    });

    test("deleteFlow rejects flows with active runs", async () => {
        const flow = {
            id: "flow-1",
            name: "Feature Dev",
            description: "test",
            actions: [
                {
                    id: "entry-1",
                    inline: {
                        name: "Plan",
                        prompt: "Plan it",
                        sessionType: "claude" as const,
                    },
                },
            ],
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
        };
        await store.saveFlow(flow);
        await store.saveFlowRun({
            taskId: "task-1",
            flowId: "flow-1",
            status: "running",
            currentActionIndex: 0,
            actions: [{ actionEntryId: "entry-1", status: "running" }],
            artifacts: [],
            startedAt: new Date().toISOString(),
        });

        expect(store.deleteFlow("flow-1")).rejects.toThrow(
            'Cannot delete flow "flow-1" while it has active runs',
        );
        expect(store.getFlows()).resolves.toHaveLength(1);
    });

    test("saveFlow rejects entries without exactly one action source", async () => {
        const createdAt = new Date().toISOString();
        const invalidFlow = {
            id: "flow-1",
            name: "Feature Dev",
            description: "test",
            actions: [
                {
                    id: "entry-1",
                    actionId: "action-1",
                    inline: {
                        name: "Plan",
                        prompt: "Plan it",
                        sessionType: "claude" as const,
                    },
                },
            ],
            createdAt,
            updatedAt: createdAt,
        };

        expect(store.saveFlow(invalidFlow as never)).rejects.toThrow(
            'Flow action "entry-1" must define exactly one of actionId or inline',
        );
    });

    test("saveFlow rejects flows without actions", async () => {
        expect(
            store.saveFlow({
                id: "flow-1",
                name: "Feature Dev",
                description: "test",
                actions: [],
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
            }),
        ).rejects.toThrow('Flow "flow-1" must define at least one action');
    });

    test("getFlows rethrows malformed JSON", async () => {
        await writeFile(join(tempDir, "flows", "definitions.json"), "{bad json");

        expect(store.getFlows()).rejects.toThrow();
    });
});

describe("flow runs", () => {
    test("saveFlowRun and getFlowRun round-trips", async () => {
        const run = {
            taskId: "task-1",
            flowId: "flow-1",
            status: "running" as const,
            currentActionIndex: 0,
            actions: [{ actionEntryId: "entry-1", status: "running" as const }],
            artifacts: [],
            startedAt: new Date().toISOString(),
        };
        await store.saveFlowRun(run);
        const result = await store.getFlowRun("task-1", "flow-1");
        expect(result).not.toBeNull();
        expect(result?.status).toBe("running");
    });

    test("getFlowRunsForOwner returns all runs for a task", async () => {
        const run1 = {
            taskId: "task-1",
            flowId: "flow-1",
            status: "completed" as const,
            currentActionIndex: 0,
            actions: [],
            artifacts: [],
            startedAt: new Date().toISOString(),
        };
        const run2 = {
            taskId: "task-1",
            flowId: "flow-2",
            status: "running" as const,
            currentActionIndex: 0,
            actions: [],
            artifacts: [],
            startedAt: new Date().toISOString(),
        };
        await store.saveFlowRun(run1);
        await store.saveFlowRun(run2);
        const runs = await store.getFlowRunsForOwner("task-1");
        expect(runs).toHaveLength(2);
    });

    test("getFlowRunsForOwner rethrows malformed JSON", async () => {
        await writeFile(join(tempDir, "flow-runs", "task-1--flow-1.json"), "{bad json");

        expect(store.getFlowRunsForOwner("task-1")).rejects.toThrow();
    });

    test("deleteFlowRun removes run", async () => {
        const run = {
            taskId: "task-1",
            flowId: "flow-1",
            status: "running" as const,
            currentActionIndex: 0,
            actions: [],
            artifacts: [],
            startedAt: new Date().toISOString(),
        };
        await store.saveFlowRun(run);
        await store.deleteFlowRun("task-1", "flow-1");
        const result = await store.getFlowRun("task-1", "flow-1");
        expect(result).toBeNull();
    });

    test("getFlowRun rethrows malformed JSON", async () => {
        await writeFile(join(tempDir, "flow-runs", "task-1--flow-1.json"), "{bad json");

        expect(store.getFlowRun("task-1", "flow-1")).rejects.toThrow();
    });
});
