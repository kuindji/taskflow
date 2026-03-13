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

describe("step definitions", () => {
    test("saveStep and getSteps round-trips", async () => {
        const step = {
            id: "step-1",
            name: "Planning",
            prompt: "Write a plan",
            sessionType: "claude" as const,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
        };
        await store.saveStep(step);
        const steps = await store.getSteps();
        expect(steps).toHaveLength(1);
        expect(steps[0].name).toBe("Planning");
    });

    test("saveStep updates existing step", async () => {
        const step = {
            id: "step-1",
            name: "Planning",
            prompt: "Write a plan",
            sessionType: "claude" as const,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
        };
        await store.saveStep(step);
        await store.saveStep({ ...step, name: "Planning v2" });
        const steps = await store.getSteps();
        expect(steps).toHaveLength(1);
        expect(steps[0].name).toBe("Planning v2");
    });

    test("deleteStep removes an unreferenced step", async () => {
        const step = {
            id: "step-1",
            name: "Planning",
            prompt: "Write a plan",
            sessionType: "claude" as const,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
        };
        await store.saveStep(step);
        await store.deleteStep("step-1");
        const steps = await store.getSteps();
        expect(steps).toHaveLength(0);
    });

    test("deleteStep rejects a referenced step", async () => {
        const step = {
            id: "step-1",
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
            steps: [{ id: "entry-1", stepId: "step-1" }],
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
        };

        await store.saveStep(step);
        await store.saveFlow(flow);

        await expect(store.deleteStep("step-1")).rejects.toThrow(
            'Cannot delete step "step-1" because it is used by: Feature Dev',
        );
        await expect(store.getSteps()).resolves.toHaveLength(1);
    });

    test("getFlowsReferencingStep returns flows that use a step", async () => {
        const step = {
            id: "step-1",
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
            steps: [{ id: "entry-1", stepId: "step-1" }],
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
        };
        await store.saveStep(step);
        await store.saveFlow(flow);

        const referencing = await store.getFlowsReferencingStep("step-1");
        expect(referencing.map((entry) => entry.id)).toEqual(["flow-1"]);
    });

    test("getSteps rethrows malformed JSON", async () => {
        await writeFile(join(tempDir, "flows", "steps.json"), "{bad json");

        await expect(store.getSteps()).rejects.toThrow();
    });
});

describe("flow definitions", () => {
    test("saveFlow and getFlows round-trips", async () => {
        const flow = {
            id: "flow-1",
            name: "Feature Dev",
            description: "Full feature lifecycle",
            steps: [
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
            steps: [],
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
        };
        await store.saveFlow(flow);
        await store.deleteFlow("flow-1");
        const flows = await store.getFlows();
        expect(flows).toHaveLength(0);
    });

    test("saveFlow rejects entries without exactly one step source", async () => {
        const createdAt = new Date().toISOString();
        const invalidFlow = {
            id: "flow-1",
            name: "Feature Dev",
            description: "test",
            steps: [
                {
                    id: "entry-1",
                    stepId: "step-1",
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

        await expect(store.saveFlow(invalidFlow as never)).rejects.toThrow(
            'Flow step "entry-1" must define exactly one of stepId or inline',
        );
    });

    test("getFlows rethrows malformed JSON", async () => {
        await writeFile(join(tempDir, "flows", "definitions.json"), "{bad json");

        await expect(store.getFlows()).rejects.toThrow();
    });
});

describe("flow runs", () => {
    test("saveFlowRun and getFlowRun round-trips", async () => {
        const run = {
            taskId: "task-1",
            flowId: "flow-1",
            status: "running" as const,
            currentStepIndex: 0,
            steps: [{ stepEntryId: "entry-1", status: "running" as const }],
            artifacts: [],
            startedAt: new Date().toISOString(),
        };
        await store.saveFlowRun(run);
        const result = await store.getFlowRun("task-1", "flow-1");
        expect(result).not.toBeNull();
        expect(result!.status).toBe("running");
    });

    test("getFlowRunsForTask returns all runs for a task", async () => {
        const run1 = {
            taskId: "task-1",
            flowId: "flow-1",
            status: "completed" as const,
            currentStepIndex: 0,
            steps: [],
            artifacts: [],
            startedAt: new Date().toISOString(),
        };
        const run2 = {
            taskId: "task-1",
            flowId: "flow-2",
            status: "running" as const,
            currentStepIndex: 0,
            steps: [],
            artifacts: [],
            startedAt: new Date().toISOString(),
        };
        await store.saveFlowRun(run1);
        await store.saveFlowRun(run2);
        const runs = await store.getFlowRunsForTask("task-1");
        expect(runs).toHaveLength(2);
    });

    test("getFlowRunsForTask rethrows malformed JSON", async () => {
        await writeFile(join(tempDir, "flow-runs", "task-1--flow-1.json"), "{bad json");

        await expect(store.getFlowRunsForTask("task-1")).rejects.toThrow();
    });

    test("deleteFlowRun removes run", async () => {
        const run = {
            taskId: "task-1",
            flowId: "flow-1",
            status: "running" as const,
            currentStepIndex: 0,
            steps: [],
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

        await expect(store.getFlowRun("task-1", "flow-1")).rejects.toThrow();
    });
});
