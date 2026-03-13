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
        getFlowRun: mock(async (taskId: string, flowId: string) => {
            const run = runs.get(`${taskId}--${flowId}`);
            return run ? structuredClone(run) : null;
        }),
        saveFlowRun: mock(async (run: FlowRun) => {
            runs.set(`${run.taskId}--${run.flowId}`, structuredClone(run));
        }),
        deleteFlowRun: mock(async (taskId: string, flowId: string) => {
            runs.delete(`${taskId}--${flowId}`);
        }),
        getFlowRunsForTask: mock(async (taskId: string) => {
            const result: FlowRun[] = [];
            for (const [key, run] of runs) {
                if (key.startsWith(`${taskId}--`)) result.push(structuredClone(run));
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
let spawnError: Error | null;
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
    spawnError = null;

    // Seed the flow definition so resolveFlowDefinition can find it
    await flowStore.saveFlow(testFlow);

    runner = new FlowRunner({
        flowStore,
        spawnSession: async (opts) => {
            if (spawnError) {
                throw spawnError;
            }
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
        expect(runner.startFlow("task-1", testFlow)).rejects.toThrow();
    });

    test("rejects empty flows", async () => {
        expect(
            runner.startFlow("task-1", {
                ...testFlow,
                id: "empty-flow",
                steps: [],
            }),
        ).rejects.toThrow('Flow "empty-flow" must define at least one step');
    });

    test("pauses and marks the step failed if session launch fails", async () => {
        spawnError = new Error("spawn failed");

        expect(runner.startFlow("task-1", testFlow)).rejects.toThrow("spawn failed");

        const run = await flowStore.getFlowRun("task-1", "flow-1");
        expect(run).not.toBeNull();
        expect(run?.status).toBe("paused");
        expect(run?.steps[0].status).toBe("failed");
        expect(run?.steps[0].sessionId).toBeUndefined();
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
        expect(run?.status).toBe("completed");
    });
});

describe("skipStep", () => {
    test("marks current step skipped and advances", async () => {
        await runner.startFlow("task-1", testFlow);
        await runner.skipStep("task-1", "flow-1");
        const run = await flowStore.getFlowRun("task-1", "flow-1");
        expect(run?.steps[0].status).toBe("skipped");
        expect(run?.currentStepIndex).toBe(1);
        expect(spawnedSessions).toHaveLength(2);
        expect(closedSessions).toEqual(["session-1"]);
    });
});

describe("jumpToStep", () => {
    test("restarts the target step and clears later step state when jumping backward", async () => {
        await runner.startFlow("task-1", testFlow);
        await runner.handleStepComplete("task-1", "flow-1", spawnedSessions[0].sessionId);

        await runner.jumpToStep("task-1", "flow-1", 0);

        const run = await flowStore.getFlowRun("task-1", "flow-1");
        expect(run?.currentStepIndex).toBe(0);
        expect(run?.steps.filter((step) => step.status === "running")).toHaveLength(1);
        expect(run?.steps[0].status).toBe("running");
        expect(run?.steps[0].sessionId).toBe("session-3");
        expect(run?.steps[1].status).toBe("pending");
        expect(run?.steps[1].sessionId).toBeUndefined();
        expect(closedSessions).toEqual(["session-2"]);
    });
});

describe("pauseFlow", () => {
    test("closes the active session and pauses the flow", async () => {
        await runner.startFlow("task-1", testFlow);
        await runner.pauseFlow("task-1", "flow-1");
        const run = await flowStore.getFlowRun("task-1", "flow-1");
        expect(run?.status).toBe("paused");
        expect(run?.steps[0].sessionId).toBeUndefined();
        expect(closedSessions).toEqual(["session-1"]);
    });
});

describe("resumeFlow", () => {
    test("restarts the paused step with a new session", async () => {
        await runner.startFlow("task-1", testFlow);
        await runner.pauseFlow("task-1", "flow-1");

        await runner.resumeFlow("task-1", "flow-1");

        const run = await flowStore.getFlowRun("task-1", "flow-1");
        expect(run?.status).toBe("running");
        expect(run?.steps[0].sessionId).toBe("session-2");
        expect(spawnedSessions).toHaveLength(2);
        expect(closedSessions).toEqual(["session-1"]);
    });
});

describe("stopFlow", () => {
    test("closes the current session and marks the flow failed", async () => {
        await runner.startFlow("task-1", testFlow);
        await runner.stopFlow("task-1", "flow-1");
        const run = await flowStore.getFlowRun("task-1", "flow-1");
        expect(run?.status).toBe("failed");
        expect(closedSessions).toEqual(["session-1"]);
    });
});

describe("handleSessionExit", () => {
    test("marks step failed when session exits without step complete", async () => {
        await runner.startFlow("task-1", testFlow);
        const sessionId = spawnedSessions[0].sessionId;
        await runner.handleSessionExit(sessionId, 1);
        const run = await flowStore.getFlowRun("task-1", "flow-1");
        expect(run?.steps[0].status).toBe("failed");
        expect(run?.status).toBe("paused");
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
        expect(run?.steps[0].status).toBe("completed");
        expect(spawnedSessions).toHaveLength(2); // Advanced to next
    });

    test("referenced shell step auto-completes on exit code 0", async () => {
        await flowStore.saveStep({
            id: "step-shell",
            name: "Lint",
            prompt: "bun run lint",
            sessionType: "shell",
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
        });
        const shellFlow: FlowDefinition = {
            ...testFlow,
            steps: [
                { id: "entry-1", stepId: "step-shell" },
                {
                    id: "entry-2",
                    inline: { name: "Review", prompt: "Review", sessionType: "claude" },
                },
            ],
        };
        await flowStore.saveFlow(shellFlow);
        await runner.startFlow("task-1", shellFlow);

        await runner.handleSessionExit(spawnedSessions[0].sessionId, 0);

        const run = await flowStore.getFlowRun("task-1", "flow-1");
        expect(run?.steps[0].status).toBe("completed");
        expect(run?.currentStepIndex).toBe(1);
        expect(run?.steps[1].status).toBe("running");
        expect(spawnedSessions).toHaveLength(2);
    });
});

describe("saveArtifact", () => {
    test("saves artifacts for the active step session", async () => {
        await runner.startFlow("task-1", testFlow);

        await runner.saveArtifact(
            "task-1",
            "flow-1",
            "entry-1",
            spawnedSessions[0].sessionId,
            { type: "summary", text: 'line "one"\nline two' },
        );

        const run = await flowStore.getFlowRun("task-1", "flow-1");
        expect(run?.artifacts).toHaveLength(1);
        expect(run?.artifacts[0]).toMatchObject({
            type: "summary",
            text: 'line "one"\nline two',
            stepEntryId: "entry-1",
        });
    });

    test("rejects artifacts for a different step entry", async () => {
        await runner.startFlow("task-1", testFlow);

        expect(
            runner.saveArtifact(
                "task-1",
                "flow-1",
                "entry-2",
                spawnedSessions[0].sessionId,
                { type: "summary", text: "bad" },
            ),
        ).rejects.toThrow("Artifacts can only be saved for the current step");
    });

    test("rejects artifacts from a different session", async () => {
        await runner.startFlow("task-1", testFlow);

        expect(
            runner.saveArtifact("task-1", "flow-1", "entry-1", "session-x", {
                type: "summary",
                text: "bad",
            }),
        ).rejects.toThrow("Artifacts can only be saved by the active step session");
    });
});
