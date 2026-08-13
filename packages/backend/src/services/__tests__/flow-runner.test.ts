import { describe, test, expect, beforeEach, mock } from "bun:test";
import { FlowRunner } from "../flow-runner";
import type { FlowStore } from "../flow-store";
import type { FlowDefinition, FlowRun, ActionDefinition, FlowOwner } from "@taskflow/shared";
import { MASTER_OWNER_ID, MSG, getFlowRunOwnerId } from "@taskflow/shared";

function createMockFlowStore(): FlowStore {
    const runs = new Map<string, FlowRun>();
    const flows: FlowDefinition[] = [];
    const actions: ActionDefinition[] = [];
    return {
        getFlows: mock(async () => flows),
        getActions: mock(async () => actions),
        getFlowRun: mock(async (ownerId: string, flowId: string) => {
            const run = runs.get(`${ownerId}--${flowId}`);
            return run ? structuredClone(run) : null;
        }),
        saveFlowRun: mock(async (run: FlowRun) => {
            const ownerId = getFlowRunOwnerId(run);
            runs.set(`${ownerId}--${run.flowId}`, structuredClone(run));
        }),
        deleteFlowRun: mock(async (ownerId: string, flowId: string) => {
            runs.delete(`${ownerId}--${flowId}`);
        }),
        getFlowRunsForOwner: mock(async (ownerId: string) => {
            const result: FlowRun[] = [];
            for (const [key, run] of runs) {
                if (key.startsWith(`${ownerId}--`)) result.push(structuredClone(run));
            }
            return result;
        }),
        getAllActiveRuns: mock(async () => {
            const result: FlowRun[] = [];
            for (const run of runs.values()) {
                if (run.status === "running" || run.status === "paused") {
                    result.push(structuredClone(run));
                }
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
        saveAction: mock(async (action: ActionDefinition) => {
            actions.push(action);
        }),
        deleteFlow: mock(async () => {}),
        deleteAction: mock(async () => {}),
        getFlowsReferencingAction: mock(async () => []),
        init: mock(async () => {}),
    } as unknown as FlowStore;
}

let flowStore: FlowStore;
let spawnedSessions: Array<{ sessionId: string; owner: FlowOwner; prompt: string }>;
let broadcasts: Array<{ type: string; payload: unknown }>;
let closedSessions: string[];
let spawnError: Error | null;
let runner: FlowRunner;

const taskOwner: FlowOwner = { taskId: "task-1" };

const testFlow: FlowDefinition = {
    id: "flow-1",
    name: "Test Flow",
    description: "test",
    actions: [
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
            spawnedSessions.push({ sessionId, owner: opts.owner, prompt: opts.prompt });
            return sessionId;
        },
        closeSession: (sessionId) => {
            closedSessions.push(sessionId);
        },
        broadcast: (msg) => {
            broadcasts.push(msg);
        },
        getOwnerDescription: async () => "Build a feature",
    });
});

describe("startFlow", () => {
    test("creates flow run and spawns first action session", async () => {
        await runner.startFlow(taskOwner, testFlow);
        expect(flowStore.saveFlowRun).toHaveBeenCalled();
        expect(spawnedSessions).toHaveLength(1);
        expect(spawnedSessions[0].owner).toEqual(taskOwner);
        expect(broadcasts.length).toBeGreaterThan(0);
    });

    test("rejects if a flow is already running on the owner", async () => {
        await runner.startFlow(taskOwner, testFlow);
        expect(runner.startFlow(taskOwner, testFlow)).rejects.toThrow();
    });

    test("rejects empty flows", async () => {
        expect(
            runner.startFlow(taskOwner, {
                ...testFlow,
                id: "empty-flow",
                actions: [],
            }),
        ).rejects.toThrow('Flow "empty-flow" must define at least one action');
    });

    test("pauses and marks the action failed if session launch fails", async () => {
        spawnError = new Error("spawn failed");

        expect(runner.startFlow(taskOwner, testFlow)).rejects.toThrow("spawn failed");

        const run = await flowStore.getFlowRun("task-1", "flow-1");
        expect(run).not.toBeNull();
        expect(run?.status).toBe("paused");
        expect(run?.actions[0].status).toBe("failed");
        expect(run?.actions[0].sessionId).toBeUndefined();
    });

    test("works with project owner", async () => {
        const projectOwner: FlowOwner = { projectId: "project-1" };
        await runner.startFlow(projectOwner, testFlow);
        expect(spawnedSessions).toHaveLength(1);
        expect(spawnedSessions[0].owner).toEqual(projectOwner);

        const run = await flowStore.getFlowRun("project-1", "flow-1");
        expect(run).not.toBeNull();
        expect(run?.projectId).toBe("project-1");
        expect(run?.taskId).toBeUndefined();
    });

    test("starts flow with master owner", async () => {
        const masterOwner: FlowOwner = { master: true };
        await runner.startFlow(masterOwner, testFlow);
        expect(flowStore.saveFlowRun).toHaveBeenCalled();
        expect(spawnedSessions.length).toBe(1);
        expect(spawnedSessions[0].owner).toEqual({ master: true });
    });
});

describe("handleActionComplete", () => {
    test("advances to next action", async () => {
        await runner.startFlow(taskOwner, testFlow);
        const sessionId = spawnedSessions[0].sessionId;
        await runner.handleActionComplete("task-1", "flow-1", sessionId);
        expect(spawnedSessions).toHaveLength(2);
    });

    test("completes flow after last action", async () => {
        await runner.startFlow(taskOwner, testFlow);
        // Complete action 1
        await runner.handleActionComplete("task-1", "flow-1", spawnedSessions[0].sessionId);
        // Complete action 2 (last)
        await runner.handleActionComplete("task-1", "flow-1", spawnedSessions[1].sessionId);
        const run = await flowStore.getFlowRun("task-1", "flow-1");
        expect(run?.status).toBe("completed");
    });
});

describe("skipAction", () => {
    test("marks current action skipped and advances", async () => {
        await runner.startFlow(taskOwner, testFlow);
        await runner.skipAction("task-1", "flow-1");
        const run = await flowStore.getFlowRun("task-1", "flow-1");
        expect(run?.actions[0].status).toBe("skipped");
        expect(run?.currentActionIndex).toBe(1);
        expect(spawnedSessions).toHaveLength(2);
        expect(closedSessions).toEqual(["session-1"]);
    });
});

describe("jumpToAction", () => {
    test("restarts the target action and clears later action state when jumping backward", async () => {
        await runner.startFlow(taskOwner, testFlow);
        await runner.handleActionComplete("task-1", "flow-1", spawnedSessions[0].sessionId);

        await runner.jumpToAction("task-1", "flow-1", 0);

        const run = await flowStore.getFlowRun("task-1", "flow-1");
        expect(run?.currentActionIndex).toBe(0);
        expect(run?.actions.filter((action) => action.status === "running")).toHaveLength(1);
        expect(run?.actions[0].status).toBe("running");
        expect(run?.actions[0].sessionId).toBe("session-3");
        expect(run?.actions[1].status).toBe("pending");
        expect(run?.actions[1].sessionId).toBeUndefined();
        expect(closedSessions).toEqual(["session-2"]);
    });
});

describe("pauseFlow", () => {
    test("closes the active session and pauses the flow", async () => {
        await runner.startFlow(taskOwner, testFlow);
        await runner.pauseFlow("task-1", "flow-1");
        const run = await flowStore.getFlowRun("task-1", "flow-1");
        expect(run?.status).toBe("paused");
        expect(run?.actions[0].sessionId).toBeUndefined();
        expect(closedSessions).toEqual(["session-1"]);
    });
});

describe("resumeFlow", () => {
    test("restarts the paused action with a new session", async () => {
        await runner.startFlow(taskOwner, testFlow);
        await runner.pauseFlow("task-1", "flow-1");

        await runner.resumeFlow("task-1", "flow-1");

        const run = await flowStore.getFlowRun("task-1", "flow-1");
        expect(run?.status).toBe("running");
        expect(run?.actions[0].sessionId).toBe("session-2");
        expect(spawnedSessions).toHaveLength(2);
        expect(closedSessions).toEqual(["session-1"]);
    });
});

describe("stopFlow", () => {
    test("closes the current session and marks the flow failed", async () => {
        await runner.startFlow(taskOwner, testFlow);
        await runner.stopFlow("task-1", "flow-1");
        const run = await flowStore.getFlowRun("task-1", "flow-1");
        expect(run?.status).toBe("failed");
        expect(closedSessions).toEqual(["session-1"]);
    });
});

describe("stopFlow — non-looped behaviour is preserved", () => {
    test("closes the session, fails the running action, leaves pending actions pending", async () => {
        await runner.startFlow(taskOwner, testFlow);
        await runner.stopFlow("task-1", "flow-1");

        const run = await flowStore.getFlowRun("task-1", "flow-1");
        expect(run?.status).toBe("failed");
        expect(run?.completedAt).toBeDefined();
        expect(run?.actions[0].status).toBe("failed");
        expect(run?.actions[0].sessionId).toBeUndefined();
        expect(run?.actions[1].status).toBe("pending");
        expect(closedSessions).toEqual(["session-1"]);
    });

    test("does not re-mark an action that is not running", async () => {
        await runner.startFlow(taskOwner, testFlow);
        await runner.skipAction("task-1", "flow-1");
        // action 0 is now "skipped", action 1 is running
        await runner.stopFlow("task-1", "flow-1");

        const run = await flowStore.getFlowRun("task-1", "flow-1");
        expect(run?.actions[0].status).toBe("skipped");
        expect(run?.actions[1].status).toBe("failed");
    });

    // The persisted-state assertions above all still pass if the run-ending path
    // stops broadcasting, which would leave every connected UI showing a run that
    // is still going. Pin the broadcast itself, not just the store write.
    test("broadcasts the ended run", async () => {
        await runner.startFlow(taskOwner, testFlow);
        broadcasts = [];
        await runner.stopFlow("task-1", "flow-1");

        const last = broadcasts.at(-1);
        expect(last?.type).toBe(MSG.FLOW_RUN_UPDATED);
        const payload = last?.payload as FlowRun;
        expect(payload.status).toBe("failed");
        expect(payload.completedAt).toBeDefined();
        expect(payload.actions[0].status).toBe("failed");
        expect(payload.actions[0].sessionId).toBeUndefined();
        expect(payload.actions[1].status).toBe("pending");
    });
});

describe("handleSessionExit", () => {
    test("marks action failed when session exits without action complete", async () => {
        await runner.startFlow(taskOwner, testFlow);
        const sessionId = spawnedSessions[0].sessionId;
        await runner.handleSessionExit(sessionId, 1);
        const run = await flowStore.getFlowRun("task-1", "flow-1");
        expect(run?.actions[0].status).toBe("failed");
        expect(run?.status).toBe("paused");
    });

    test("shell action auto-completes on exit code 0", async () => {
        const shellFlow: FlowDefinition = {
            ...testFlow,
            actions: [
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
        await runner.startFlow(taskOwner, shellFlow);
        const sessionId = spawnedSessions[0].sessionId;
        await runner.handleSessionExit(sessionId, 0);
        const run = await flowStore.getFlowRun("task-1", "flow-1");
        expect(run?.actions[0].status).toBe("completed");
        expect(spawnedSessions).toHaveLength(2); // Advanced to next
    });

    test("referenced shell action auto-completes on exit code 0", async () => {
        await flowStore.saveAction({
            id: "action-shell",
            name: "Lint",
            prompt: "bun run lint",
            sessionType: "shell",
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
        });
        const shellFlow: FlowDefinition = {
            ...testFlow,
            actions: [
                { id: "entry-1", actionId: "action-shell" },
                {
                    id: "entry-2",
                    inline: { name: "Review", prompt: "Review", sessionType: "claude" },
                },
            ],
        };
        await flowStore.saveFlow(shellFlow);
        await runner.startFlow(taskOwner, shellFlow);

        await runner.handleSessionExit(spawnedSessions[0].sessionId, 0);

        const run = await flowStore.getFlowRun("task-1", "flow-1");
        expect(run?.actions[0].status).toBe("completed");
        expect(run?.currentActionIndex).toBe(1);
        expect(run?.actions[1].status).toBe("running");
        expect(spawnedSessions).toHaveLength(2);
    });
});

describe("getFlowRunOwnerId", () => {
    test("returns __master__ for master owner", () => {
        const run = {
            master: true,
            flowId: "flow-1",
            status: "running" as const,
            currentActionIndex: 0,
            actions: [],
            artifacts: [],
            startedAt: new Date().toISOString(),
        };
        expect(getFlowRunOwnerId(run as FlowRun)).toBe(MASTER_OWNER_ID);
    });
});

describe("saveArtifact", () => {
    test("saves artifacts for the active action session", async () => {
        await runner.startFlow(taskOwner, testFlow);

        await runner.saveArtifact("task-1", "flow-1", "entry-1", spawnedSessions[0].sessionId, {
            type: "summary",
            text: 'line "one"\nline two',
        });

        const run = await flowStore.getFlowRun("task-1", "flow-1");
        expect(run?.artifacts).toHaveLength(1);
        expect(run?.artifacts[0]).toMatchObject({
            type: "summary",
            text: 'line "one"\nline two',
            actionEntryId: "entry-1",
        });
    });

    test("rejects artifacts for a different action entry", async () => {
        await runner.startFlow(taskOwner, testFlow);

        expect(
            runner.saveArtifact("task-1", "flow-1", "entry-2", spawnedSessions[0].sessionId, {
                type: "summary",
                text: "bad",
            }),
        ).rejects.toThrow("Artifacts can only be saved for the current action");
    });

    test("rejects artifacts from a different session", async () => {
        await runner.startFlow(taskOwner, testFlow);

        expect(
            runner.saveArtifact("task-1", "flow-1", "entry-1", "session-x", {
                type: "summary",
                text: "bad",
            }),
        ).rejects.toThrow("Artifacts can only be saved by the active action session");
    });
});
