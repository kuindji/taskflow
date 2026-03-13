import { describe, test, expect, beforeEach, mock } from "bun:test";
import { FlowRunner } from "../flow-runner";
import type { FlowStore } from "../flow-store";
import type { FlowDefinition, FlowRun, StepDefinition } from "@taskflow/shared";

function createMockFlowStore(): FlowStore {
    const runs = new Map<string, FlowRun>();
    const flows: FlowDefinition[] = [];
    const steps: StepDefinition[] = [];
    return {
        getFlows: mock(async () => flows),
        getSteps: mock(async () => steps),
        getFlowRun: mock(async (taskId: string, flowId: string) =>
            runs.get(`${taskId}--${flowId}`) ?? null,
        ),
        saveFlowRun: mock(async (run: FlowRun) => {
            runs.set(`${run.taskId}--${run.flowId}`, run);
        }),
        deleteFlowRun: mock(async (taskId: string, flowId: string) => {
            runs.delete(`${taskId}--${flowId}`);
        }),
        getFlowRunsForTask: mock(async (taskId: string) => {
            const result: FlowRun[] = [];
            for (const [key, run] of runs) {
                if (key.startsWith(`${taskId}--`)) result.push(run);
            }
            return result;
        }),
        saveFlow: mock(async (flow: FlowDefinition) => {
            const index = flows.findIndex((f) => f.id === flow.id);
            if (index >= 0) {
                flows[index] = flow;
            } else {
                flows.push(flow);
            }
        }),
        saveStep: mock(async (step: StepDefinition) => {
            steps.push(step);
        }),
        deleteFlow: mock(async () => {}),
        deleteStep: mock(async () => {}),
        getFlowsReferencingStep: mock(async () => []),
        init: mock(async () => {}),
    } as unknown as FlowStore;
}

let flowStore: FlowStore;
let spawnedSessions: Array<{ sessionId: string; taskId: string; prompt: string }>;
let broadcasts: Array<{ type: string; payload: unknown }>;
let closedSessions: string[];
let runner: FlowRunner;

const testFlow: FlowDefinition = {
    id: "flow-1",
    name: "Test Flow",
    description: "test",
    steps: [
        {
            id: "entry-1",
            inline: { name: "Plan", prompt: "Write a plan", sessionType: "claude" },
        },
        {
            id: "entry-2",
            inline: { name: "Review", prompt: "Review the plan", sessionType: "claude" },
        },
    ],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
};

beforeEach(async () => {
    flowStore = createMockFlowStore();
    spawnedSessions = [];
    broadcasts = [];
    closedSessions = [];

    // Seed the flow definition so resolveFlowDefinition can find it
    await flowStore.saveFlow(testFlow);

    runner = new FlowRunner({
        flowStore,
        spawnSession: async (opts) => {
            const sessionId = `session-${spawnedSessions.length + 1}`;
            spawnedSessions.push({ sessionId, taskId: opts.taskId, prompt: opts.prompt });
            return sessionId;
        },
        closeSession: (sessionId) => {
            closedSessions.push(sessionId);
        },
        broadcast: (msg) => {
            broadcasts.push(msg);
        },
        getTaskDescription: async () => "Build a feature",
    });
});

describe("startFlow", () => {
    test("creates flow run and spawns first step session", async () => {
        await runner.startFlow("task-1", testFlow);
        expect(flowStore.saveFlowRun).toHaveBeenCalled();
        expect(spawnedSessions).toHaveLength(1);
        expect(spawnedSessions[0].taskId).toBe("task-1");
        expect(broadcasts.length).toBeGreaterThan(0);
    });

    test("rejects if a flow is already running on the task", async () => {
        await runner.startFlow("task-1", testFlow);
        await expect(runner.startFlow("task-1", testFlow)).rejects.toThrow();
    });
});

describe("handleStepComplete", () => {
    test("advances to next step", async () => {
        await runner.startFlow("task-1", testFlow);
        const sessionId = spawnedSessions[0].sessionId;
        await runner.handleStepComplete("task-1", "flow-1", sessionId);
        expect(spawnedSessions).toHaveLength(2);
    });

    test("completes flow after last step", async () => {
        await runner.startFlow("task-1", testFlow);
        // Complete step 1
        await runner.handleStepComplete("task-1", "flow-1", spawnedSessions[0].sessionId);
        // Complete step 2 (last)
        await runner.handleStepComplete("task-1", "flow-1", spawnedSessions[1].sessionId);
        const run = await flowStore.getFlowRun("task-1", "flow-1");
        expect(run!.status).toBe("completed");
    });
});

describe("skipStep", () => {
    test("marks current step skipped and advances", async () => {
        await runner.startFlow("task-1", testFlow);
        await runner.skipStep("task-1", "flow-1");
        const run = await flowStore.getFlowRun("task-1", "flow-1");
        expect(run!.steps[0].status).toBe("skipped");
        expect(run!.currentStepIndex).toBe(1);
        expect(spawnedSessions).toHaveLength(2);
        expect(closedSessions).toEqual(["session-1"]);
    });
});

describe("pauseFlow", () => {
    test("sets flow status to paused", async () => {
        await runner.startFlow("task-1", testFlow);
        await runner.pauseFlow("task-1", "flow-1");
        const run = await flowStore.getFlowRun("task-1", "flow-1");
        expect(run!.status).toBe("paused");
    });
});

describe("stopFlow", () => {
    test("closes the current session and marks the flow failed", async () => {
        await runner.startFlow("task-1", testFlow);
        await runner.stopFlow("task-1", "flow-1");
        const run = await flowStore.getFlowRun("task-1", "flow-1");
        expect(run!.status).toBe("failed");
        expect(closedSessions).toEqual(["session-1"]);
    });
});

describe("handleSessionExit", () => {
    test("marks step failed when session exits without step complete", async () => {
        await runner.startFlow("task-1", testFlow);
        const sessionId = spawnedSessions[0].sessionId;
        await runner.handleSessionExit(sessionId, 1);
        const run = await flowStore.getFlowRun("task-1", "flow-1");
        expect(run!.steps[0].status).toBe("failed");
        expect(run!.status).toBe("paused");
    });

    test("shell step auto-completes on exit code 0", async () => {
        const shellFlow: FlowDefinition = {
            ...testFlow,
            steps: [
                {
                    id: "entry-1",
                    inline: { name: "Lint", prompt: "bun run lint", sessionType: "shell" },
                },
                {
                    id: "entry-2",
                    inline: { name: "Review", prompt: "Review", sessionType: "claude" },
                },
            ],
        };
        await flowStore.saveFlow(shellFlow);
        await runner.startFlow("task-1", shellFlow);
        const sessionId = spawnedSessions[0].sessionId;
        await runner.handleSessionExit(sessionId, 0);
        const run = await flowStore.getFlowRun("task-1", "flow-1");
        expect(run!.steps[0].status).toBe("completed");
        expect(spawnedSessions).toHaveLength(2); // Advanced to next
    });
});
