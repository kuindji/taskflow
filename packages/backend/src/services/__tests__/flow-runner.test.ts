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

const loopFlow: FlowDefinition = {
    id: "loop-flow",
    name: "Loop Flow",
    description: "test",
    loop: true,
    actions: [
        { id: "entry-1", inline: { name: "Plan", prompt: "Write a plan", sessionType: "claude" } },
        { id: "entry-2", inline: { name: "Review", prompt: "Review it", sessionType: "claude" } },
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
    await flowStore.saveFlow(loopFlow);

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

    // Guard for the looped counterpart below: a finite run still drops the
    // artifacts of the action it is about to retry, since that action never
    // finished and anything it saved is partial.
    test("drops the retried action's artifacts on a non-looped run", async () => {
        await runner.startFlow(taskOwner, testFlow);
        await runner.saveArtifact("task-1", "flow-1", "entry-1", spawnedSessions[0].sessionId, {
            type: "plan",
            text: "half-written plan",
        });
        await runner.pauseFlow("task-1", "flow-1");

        await runner.resumeFlow("task-1", "flow-1");

        const run = await flowStore.getFlowRun("task-1", "flow-1");
        expect(run?.artifacts).toEqual([]);
    });

    // The purge is scoped to the action being retried. An earlier action's
    // output is finished work the retry may be about to read, so it survives —
    // on a finite run as much as on a looped one.
    test("keeps another action's artifacts while dropping the retried action's", async () => {
        await runner.startFlow(taskOwner, testFlow);
        await runner.saveArtifact("task-1", "flow-1", "entry-1", spawnedSessions[0].sessionId, {
            type: "plan",
            text: "finished plan from action 1",
        });
        await runner.handleActionComplete("task-1", "flow-1", spawnedSessions[0].sessionId);
        await runner.saveArtifact("task-1", "flow-1", "entry-2", spawnedSessions[1].sessionId, {
            type: "review",
            text: "half-written review",
        });
        await runner.pauseFlow("task-1", "flow-1");

        await runner.resumeFlow("task-1", "flow-1");

        const run = await flowStore.getFlowRun("task-1", "flow-1");
        expect(run?.currentActionIndex).toBe(1);
        expect(run?.artifacts).toHaveLength(1);
        expect(run?.artifacts[0].actionEntryId).toBe("entry-1");
        expect(run?.artifacts[0].text).toBe("finished plan from action 1");
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

describe("stopFlow — looped runs", () => {
    test("ends a looped run as completed with the in-flight step skipped", async () => {
        await runner.startFlow(taskOwner, loopFlow);
        await runner.stopFlow("task-1", "loop-flow");

        const run = await flowStore.getFlowRun("task-1", "loop-flow");
        expect(run?.status).toBe("completed");
        expect(run?.completedAt).toBeDefined();
        expect(run?.actions[0].status).toBe("skipped");
        expect(run?.actions[1].status).toBe("skipped");
        expect(closedSessions).toEqual(["session-1"]);
    });

    // Asserts on `broadcasts` rather than on `completedAt`: endRun stamps
    // new Date().toISOString(), so two back-to-back stops land in the same
    // millisecond and a timestamp comparison would go green against unguarded
    // code. Every write path in endRun ends in broadcastUpdate.
    test("stopping an already-ended run writes nothing", async () => {
        await runner.startFlow(taskOwner, loopFlow);
        await runner.stopFlow("task-1", "loop-flow");
        const broadcastCount = broadcasts.length;

        await runner.stopFlow("task-1", "loop-flow");

        expect(broadcasts).toHaveLength(broadcastCount);
        expect(closedSessions).toEqual(["session-1"]);
    });

    test("ends a looped run paused on a failed action as failed, not completed", async () => {
        await runner.startFlow(taskOwner, loopFlow);
        await runner.handleActionComplete("task-1", "loop-flow", spawnedSessions[0].sessionId);
        // The agent on action 1 exits without signalling completion: the action
        // is marked failed and the run is paused.
        await runner.handleSessionExit(spawnedSessions[1].sessionId, 1);

        await runner.stopFlow("task-1", "loop-flow");

        const run = await flowStore.getFlowRun("task-1", "loop-flow");
        expect(run?.status).toBe("failed");
        expect(run?.completedAt).toBeDefined();
        expect(run?.actions[0].status).toBe("completed");
        expect(run?.actions[1].status).toBe("failed");
    });

    // Companion guard for the test above: pins that only a *failed* current
    // action turns a loop stop into a failure. pauseFlow leaves the action
    // "running", so a manual pause still ends the loop as completed.
    test("ends a manually paused looped run as completed", async () => {
        await runner.startFlow(taskOwner, loopFlow);
        await runner.pauseFlow("task-1", "loop-flow");

        await runner.stopFlow("task-1", "loop-flow");

        const run = await flowStore.getFlowRun("task-1", "loop-flow");
        expect(run?.status).toBe("completed");
        expect(run?.actions[0].status).toBe("skipped");
        expect(run?.actions[1].status).toBe("skipped");
    });

    // Pins that the discriminator reads the *current* action, not "any failed
    // action in the run". jumpToAction leaves an earlier failed action in place
    // while the run carries on, so a stop after a deliberate jump past a failure
    // is a normal loop ending, not a failure.
    test("ends a looped run stopped after jumping past a failed action as completed", async () => {
        await runner.startFlow(taskOwner, loopFlow);
        // Action 0's agent exits without signalling completion: it is marked
        // failed and the run is paused.
        await runner.handleSessionExit(spawnedSessions[0].sessionId, 1);
        // The user deliberately moves past it; action 0 stays failed.
        await runner.jumpToAction("task-1", "loop-flow", 1);

        await runner.stopFlow("task-1", "loop-flow");

        const run = await flowStore.getFlowRun("task-1", "loop-flow");
        expect(run?.status).toBe("completed");
        expect(run?.actions[0].status).toBe("failed");
        expect(run?.actions[1].status).toBe("skipped");
    });
});

describe("owner lock", () => {
    test("concurrent action completions advance the run only once", async () => {
        await runner.startFlow(taskOwner, testFlow);
        const sessionId = spawnedSessions[0].sessionId;

        await Promise.all([
            runner.handleActionComplete("task-1", "flow-1", sessionId),
            runner.handleActionComplete("task-1", "flow-1", sessionId),
        ]);

        // One session for action 0, one for action 1. A duplicate advance
        // would spawn a third.
        expect(spawnedSessions).toHaveLength(2);

        const run = await flowStore.getFlowRun("task-1", "flow-1");
        expect(run?.currentActionIndex).toBe(1);
    });

    test("a session exit racing a completion does not overwrite the advanced run", async () => {
        await runner.startFlow(taskOwner, testFlow);
        const sessionId = spawnedSessions[0].sessionId;

        await Promise.all([
            runner.handleActionComplete("task-1", "flow-1", sessionId),
            runner.handleSessionExit(sessionId, 0),
        ]);

        const run = await flowStore.getFlowRun("task-1", "flow-1");
        expect(run?.status).toBe("running");
        expect(run?.currentActionIndex).toBe(1);
        expect(run?.actions[0].status).toBe("completed");
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

describe("looping", () => {
    test("wraps to iteration 2 instead of completing", async () => {
        await runner.startFlow(taskOwner, loopFlow);
        await runner.handleActionComplete("task-1", "loop-flow", spawnedSessions[0].sessionId);
        await runner.handleActionComplete("task-1", "loop-flow", spawnedSessions[1].sessionId);

        const run = await flowStore.getFlowRun("task-1", "loop-flow");
        expect(run?.status).toBe("running");
        expect(run?.iteration).toBe(2);
        expect(run?.currentActionIndex).toBe(0);
        expect(run?.actions[0].status).toBe("running");
        expect(run?.actions[1].status).toBe("pending");
        expect(run?.actions[1].completedAt).toBeUndefined();
        expect(spawnedSessions).toHaveLength(3);
    });

    test("carries inputs and artifacts across the wrap", async () => {
        const inputFlow: FlowDefinition = {
            ...loopFlow,
            id: "loop-input-flow",
            inputs: [{ id: "topic", label: "Topic", type: "text" }],
        };
        await flowStore.saveFlow(inputFlow);
        await runner.startFlow(taskOwner, inputFlow, { topic: "caching" });

        await runner.saveArtifact(
            "task-1",
            "loop-input-flow",
            "entry-1",
            spawnedSessions[0].sessionId,
            { type: "plan", text: "iteration one plan" },
        );
        await runner.handleActionComplete(
            "task-1",
            "loop-input-flow",
            spawnedSessions[0].sessionId,
        );
        await runner.handleActionComplete(
            "task-1",
            "loop-input-flow",
            spawnedSessions[1].sessionId,
        );

        const run = await flowStore.getFlowRun("task-1", "loop-input-flow");
        // Pin that we actually wrapped — without these three, the test passes on
        // current code, since a completed finite run also retains inputs/artifacts.
        expect(run?.status).toBe("running");
        expect(run?.iteration).toBe(2);
        expect(run?.currentActionIndex).toBe(0);
        expect(run?.inputValues).toEqual({ topic: "caching" });
        expect(run?.artifacts).toHaveLength(1);
        expect(run?.artifacts[0].text).toBe("iteration one plan");
    });

    test("an artifact re-saved in iteration 2 replaces the iteration 1 value", async () => {
        await runner.startFlow(taskOwner, loopFlow);
        await runner.saveArtifact("task-1", "loop-flow", "entry-1", spawnedSessions[0].sessionId, {
            type: "plan",
            text: "first",
        });
        await runner.handleActionComplete("task-1", "loop-flow", spawnedSessions[0].sessionId);
        await runner.handleActionComplete("task-1", "loop-flow", spawnedSessions[1].sessionId);

        // Now in iteration 2, action 0, on a fresh session
        await runner.saveArtifact("task-1", "loop-flow", "entry-1", spawnedSessions[2].sessionId, {
            type: "plan",
            text: "second",
        });

        const run = await flowStore.getFlowRun("task-1", "loop-flow");
        expect(run?.artifacts).toHaveLength(1);
        expect(run?.artifacts[0].text).toBe("second");
    });

    test("editing loop off on the definition does not change a run already in flight", async () => {
        await runner.startFlow(taskOwner, loopFlow);
        await flowStore.saveFlow({ ...loopFlow, loop: false });

        await runner.handleActionComplete("task-1", "loop-flow", spawnedSessions[0].sessionId);
        await runner.handleActionComplete("task-1", "loop-flow", spawnedSessions[1].sessionId);

        const run = await flowStore.getFlowRun("task-1", "loop-flow");
        expect(run?.status).toBe("running");
        expect(run?.iteration).toBe(2);
    });

    test("a launch failure on the first action of a new iteration pauses the run", async () => {
        await runner.startFlow(taskOwner, loopFlow);
        await runner.handleActionComplete("task-1", "loop-flow", spawnedSessions[0].sessionId);
        spawnError = new Error("spawn failed");

        const rejection = await runner
            .handleActionComplete("task-1", "loop-flow", spawnedSessions[1].sessionId)
            .catch((error: unknown) => error);
        expect(rejection).toBeInstanceOf(Error);
        expect(rejection).toHaveProperty("message", "spawn failed");

        const run = await flowStore.getFlowRun("task-1", "loop-flow");
        expect(run?.status).toBe("paused");
        expect(run?.iteration).toBe(2);
        expect(run?.actions[0].status).toBe("failed");
    });

    test("resuming a wrapped iteration keeps the artifact carried from the previous one", async () => {
        await runner.startFlow(taskOwner, loopFlow);
        await runner.saveArtifact("task-1", "loop-flow", "entry-1", spawnedSessions[0].sessionId, {
            type: "plan",
            text: "iteration one plan",
        });
        await runner.handleActionComplete("task-1", "loop-flow", spawnedSessions[0].sessionId);
        // The wrap's relaunch of action 0 fails, leaving the run paused at
        // iteration 2 with iteration 1's artifact still attached.
        spawnError = new Error("spawn failed");
        await runner
            .handleActionComplete("task-1", "loop-flow", spawnedSessions[1].sessionId)
            .catch(() => undefined);

        let run = await flowStore.getFlowRun("task-1", "loop-flow");
        expect(run?.iteration).toBe(2);
        expect(run?.artifacts).toHaveLength(1);

        spawnError = null;
        await runner.resumeFlow("task-1", "loop-flow");

        run = await flowStore.getFlowRun("task-1", "loop-flow");
        expect(run?.status).toBe("running");
        expect(run?.iteration).toBe(2);
        // Retrying action 0 must not delete the output the wrap deliberately
        // carried over — the retried action may well be reading it.
        expect(run?.artifacts).toHaveLength(1);
        expect(run?.artifacts[0].text).toBe("iteration one plan");
    });

    test("resuming drops an artifact the current iteration's failed attempt saved", async () => {
        await runner.startFlow(taskOwner, loopFlow);
        await runner.saveArtifact("task-1", "loop-flow", "entry-1", spawnedSessions[0].sessionId, {
            type: "plan",
            text: "good iteration one plan",
        });
        await runner.handleActionComplete("task-1", "loop-flow", spawnedSessions[0].sessionId);
        await runner.handleActionComplete("task-1", "loop-flow", spawnedSessions[1].sessionId);
        // Iteration 2, action 0. The attempt saves a partial plan — which replaces
        // the carried iteration-1 value, since saveArtifact dedupes on
        // (actionEntryId, type) — and then dies without signalling completion.
        await runner.saveArtifact("task-1", "loop-flow", "entry-1", spawnedSessions[2].sessionId, {
            type: "plan",
            text: "partial plan from the failed attempt",
        });
        await runner.handleSessionExit(spawnedSessions[2].sessionId, 1);

        let run = await flowStore.getFlowRun("task-1", "loop-flow");
        expect(run?.status).toBe("paused");
        expect(run?.artifacts[0].text).toBe("partial plan from the failed attempt");

        await runner.resumeFlow("task-1", "loop-flow");

        run = await flowStore.getFlowRun("task-1", "loop-flow");
        // The retry may complete without re-saving `plan`. If the failed attempt's
        // partial survives, action 1 reads it as if it were a finished value.
        expect(run?.artifacts).toEqual([]);
    });

    test("resuming drops an artifact that carries no iteration stamp", async () => {
        // A stamp is written by saveArtifact for every artifact a looped run
        // produces, so an unstamped one can only come from outside this code —
        // a hand-edited run file, or one persisted before the stamp existed.
        // Such a value cannot be told apart from the failed attempt's own
        // partial output, so it must be dropped rather than read as finished.
        await flowStore.saveFlowRun({
            taskId: "task-1",
            flowId: "loop-flow",
            status: "paused",
            loop: true,
            iteration: 2,
            currentActionIndex: 0,
            actions: [
                {
                    actionEntryId: "entry-1",
                    status: "failed",
                    startedAt: "2026-08-13T10:00:00.000Z",
                    completedAt: "2026-08-13T10:01:00.000Z",
                },
                { actionEntryId: "entry-2", status: "pending" },
            ],
            artifacts: [
                {
                    actionEntryId: "entry-1",
                    type: "plan",
                    text: "unstamped partial from the failed attempt",
                    createdAt: "2026-08-13T10:00:30.000Z",
                },
            ],
            startedAt: "2026-08-13T09:00:00.000Z",
        });

        await runner.resumeFlow("task-1", "loop-flow");

        const run = await flowStore.getFlowRun("task-1", "loop-flow");
        expect(run?.artifacts).toEqual([]);
    });

    test("a step failing mid-loop pauses the run instead of wrapping, and Resume retries it", async () => {
        await runner.startFlow(taskOwner, loopFlow);
        await runner.handleActionComplete("task-1", "loop-flow", spawnedSessions[0].sessionId);
        // Agent on the last step exits without signalling completion.
        await runner.handleSessionExit(spawnedSessions[1].sessionId, 1);

        let run = await flowStore.getFlowRun("task-1", "loop-flow");
        expect(run?.status).toBe("paused");
        expect(run?.iteration).toBe(1);
        expect(run?.currentActionIndex).toBe(1);
        expect(run?.actions[1].status).toBe("failed");

        await runner.resumeFlow("task-1", "loop-flow");

        run = await flowStore.getFlowRun("task-1", "loop-flow");
        expect(run?.status).toBe("running");
        expect(run?.iteration).toBe(1);
        expect(run?.currentActionIndex).toBe(1);
        expect(spawnedSessions).toHaveLength(3);
    });

    // Regression guard: green before and after. Pins that adding the wrap branch
    // does not change the finite-flow path.
    test("a non-looped flow still completes after its last action", async () => {
        await runner.startFlow(taskOwner, testFlow);
        await runner.handleActionComplete("task-1", "flow-1", spawnedSessions[0].sessionId);
        await runner.handleActionComplete("task-1", "flow-1", spawnedSessions[1].sessionId);

        const run = await flowStore.getFlowRun("task-1", "flow-1");
        expect(run?.status).toBe("completed");
        expect(run?.iteration).toBeUndefined();
    });
});

describe("getArtifacts", () => {
    test("does not reorder the run's artifact array", async () => {
        await runner.startFlow(taskOwner, testFlow);
        const run = await flowStore.getFlowRun("task-1", "flow-1");
        if (!run) throw new Error("expected a run");
        run.artifacts = [
            {
                type: "a",
                text: "older",
                actionEntryId: "entry-1",
                createdAt: "2020-01-01T00:00:00.000Z",
            },
            {
                type: "b",
                text: "newer",
                actionEntryId: "entry-1",
                createdAt: "2030-01-01T00:00:00.000Z",
            },
        ];

        runner.getArtifacts(run);

        expect(run.artifacts.map((a) => a.type)).toEqual(["a", "b"]);
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
