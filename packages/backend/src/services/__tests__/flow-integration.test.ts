import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { FlowStore } from "../flow-store";
import { FlowRunner } from "../flow-runner";
import type { FlowDefinition, FlowOwner } from "@taskflow/shared";

describe("flow lifecycle integration", () => {
    let tempDir: string;
    let flowStore: FlowStore;
    let runner: FlowRunner;
    let spawnedSessions: Array<{ sessionId: string; owner: FlowOwner; prompt: string }>;
    let closedSessions: string[];
    let broadcasts: Array<{ type: string; payload: unknown }>;

    const taskOwner: FlowOwner = { taskId: "task-1" };

    const testFlow: FlowDefinition = {
        id: "flow-1",
        name: "Test Flow",
        description: "Integration test flow",
        actions: [
            {
                id: "e1",
                inline: { name: "Action 1", prompt: "Do first", sessionType: "claude" },
            },
            {
                id: "e2",
                inline: { name: "Action 2", prompt: "Do second", sessionType: "claude" },
            },
        ],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
    };

    beforeEach(async () => {
        tempDir = await mkdtemp(join(tmpdir(), "flow-int-test-"));
        flowStore = new FlowStore(join(tempDir, "flows"), join(tempDir, "flow-runs"));
        await flowStore.init();
        spawnedSessions = [];
        closedSessions = [];
        broadcasts = [];

        await flowStore.saveFlow(testFlow);

        runner = new FlowRunner({
            flowStore,
            spawnSession: async (opts) => {
                const sessionId = `session-${spawnedSessions.length + 1}`;
                spawnedSessions.push({
                    sessionId,
                    owner: opts.owner,
                    prompt: opts.prompt,
                });
                return sessionId;
            },
            closeSession: (sessionId) => {
                closedSessions.push(sessionId);
            },
            broadcast: (msg) => {
                broadcasts.push(msg);
            },
            getOwnerDescription: async () => "Test task description",
        });
    });

    afterEach(async () => {
        await rm(tempDir, { recursive: true, force: true });
    });

    test("full flow runs to completion", async () => {
        await runner.startFlow(taskOwner, testFlow);
        expect(spawnedSessions).toHaveLength(1);

        // Complete action 1
        await runner.handleActionComplete("task-1", "flow-1", "session-1");
        expect(spawnedSessions).toHaveLength(2);

        // Complete action 2
        await runner.handleActionComplete("task-1", "flow-1", "session-2");

        const run = await flowStore.getFlowRun("task-1", "flow-1");
        expect(run).not.toBeNull();
        expect(run?.status).toBe("completed");
        expect(run?.actions.every((s) => s.status === "completed")).toBe(true);
    });

    test("artifacts persist across actions", async () => {
        await runner.startFlow(taskOwner, testFlow);

        // Save artifact in action 1
        await runner.saveArtifact("task-1", "flow-1", "e1", "session-1", {
            type: "plan",
            path: "docs/plan.md",
        });

        // Complete action 1
        await runner.handleActionComplete("task-1", "flow-1", "session-1");

        // Verify artifact persists after advancing
        const run = await flowStore.getFlowRun("task-1", "flow-1");
        expect(run).not.toBeNull();
        if (!run) throw new Error("expected run");
        const artifacts = runner.getArtifacts(run, "plan");
        expect(artifacts).toHaveLength(1);
        expect(artifacts[0].path).toBe("docs/plan.md");
    });

    test("pause and resume preserves state", async () => {
        await runner.startFlow(taskOwner, testFlow);
        expect(spawnedSessions).toHaveLength(1);

        // Pause
        await runner.pauseFlow("task-1", "flow-1");
        let run = await flowStore.getFlowRun("task-1", "flow-1");
        expect(run?.status).toBe("paused");
        expect(run?.actions[0].sessionId).toBeUndefined();
        expect(closedSessions).toEqual(["session-1"]);

        // Resume
        await runner.resumeFlow("task-1", "flow-1");
        run = await flowStore.getFlowRun("task-1", "flow-1");
        expect(run?.status).toBe("running");
        expect(run?.actions[0].sessionId).toBe("session-2");
        expect(spawnedSessions).toHaveLength(2);
    });

    test("skip action advances to next", async () => {
        await runner.startFlow(taskOwner, testFlow);
        expect(spawnedSessions).toHaveLength(1);

        // Skip action 1
        await runner.skipAction("task-1", "flow-1");

        const run = await flowStore.getFlowRun("task-1", "flow-1");
        expect(run).not.toBeNull();
        expect(run?.actions[0].status).toBe("skipped");
        expect(run?.currentActionIndex).toBe(1);
        // Should have spawned a session for action 2
        expect(spawnedSessions).toHaveLength(2);
    });

    test("jumping backward from an active later action resets later state", async () => {
        await runner.startFlow(taskOwner, testFlow);

        // Advance into action 2 so the later action is actively running.
        await runner.handleActionComplete("task-1", "flow-1", "session-1");

        let run = await flowStore.getFlowRun("task-1", "flow-1");
        expect(run?.status).toBe("running");
        expect(run?.currentActionIndex).toBe(1);
        expect(run?.actions[1].status).toBe("running");
        expect(run?.actions[1].sessionId).toBe("session-2");

        // Jump back to action 0
        await runner.jumpToAction("task-1", "flow-1", 0);

        run = await flowStore.getFlowRun("task-1", "flow-1");
        expect(run?.status).toBe("running");
        expect(run?.currentActionIndex).toBe(0);
        expect(run?.actions[0].status).toBe("running");
        expect(run?.actions[0].sessionId).toBe("session-3");
        // Later actions should be reset to pending
        expect(run?.actions[1].status).toBe("pending");
        expect(run?.actions[1].sessionId).toBeUndefined();
        expect(run?.actions.filter((action) => action.status === "running")).toHaveLength(1);
        expect(closedSessions).toEqual(["session-2"]);
    });

    test("stop flow marks it as failed", async () => {
        await runner.startFlow(taskOwner, testFlow);

        await runner.stopFlow("task-1", "flow-1");

        const run = await flowStore.getFlowRun("task-1", "flow-1");
        expect(run?.status).toBe("failed");
    });

    test("flow run persists to disk and survives reload", async () => {
        await runner.startFlow(taskOwner, testFlow);
        await runner.handleActionComplete("task-1", "flow-1", "session-1");

        // Create a new FlowStore pointing at same directory
        const freshStore = new FlowStore(join(tempDir, "flows"), join(tempDir, "flow-runs"));
        await freshStore.init();

        const run = await freshStore.getFlowRun("task-1", "flow-1");
        expect(run).not.toBeNull();
        expect(run?.status).toBe("running");
        expect(run?.actions[0].status).toBe("completed");
        expect(run?.actions[1].status).toBe("running");
        expect(run?.currentActionIndex).toBe(1);
    });

    test("shell actions auto-complete on clean exit and advance the flow", async () => {
        const shellFlow: FlowDefinition = {
            ...testFlow,
            actions: [
                {
                    id: "e1",
                    inline: { name: "Lint", prompt: "bun run lint", sessionType: "shell" },
                },
                testFlow.actions[1],
            ],
        };
        await flowStore.saveFlow(shellFlow);

        await runner.startFlow(taskOwner, shellFlow);
        expect(spawnedSessions).toHaveLength(1);

        await runner.handleSessionExit("session-1", 0);

        const run = await flowStore.getFlowRun("task-1", "flow-1");
        expect(run).not.toBeNull();
        expect(run?.status).toBe("running");
        expect(run?.actions[0].status).toBe("completed");
        expect(run?.actions[1].status).toBe("running");
        expect(run?.actions[1].sessionId).toBe("session-2");
        expect(spawnedSessions).toHaveLength(2);
    });

    test("runs a looped flow through two iterations and ends on completeFlow", async () => {
        const loopFlow: FlowDefinition = {
            ...testFlow,
            id: "loop-flow",
            loop: true,
        };
        await flowStore.saveFlow(loopFlow);
        await runner.startFlow(taskOwner, loopFlow);

        await runner.handleActionComplete("task-1", "loop-flow", spawnedSessions[0].sessionId);
        await runner.handleActionComplete("task-1", "loop-flow", spawnedSessions[1].sessionId);

        let run = await flowStore.getFlowRun("task-1", "loop-flow");
        expect(run?.iteration).toBe(2);
        expect(run?.status).toBe("running");

        await runner.completeFlow("task-1", "loop-flow", spawnedSessions[2].sessionId);

        run = await flowStore.getFlowRun("task-1", "loop-flow");
        expect(run?.status).toBe("completed");
    });

    test("resumes a looped run in the same iteration after crash recovery", async () => {
        const loopFlow: FlowDefinition = { ...testFlow, id: "loop-recover", loop: true };
        await flowStore.saveFlow(loopFlow);
        await runner.startFlow(taskOwner, loopFlow);
        await runner.handleActionComplete("task-1", "loop-recover", spawnedSessions[0].sessionId);
        await runner.handleActionComplete("task-1", "loop-recover", spawnedSessions[1].sessionId);

        // Replicate the startup recovery transform from index.ts:242.
        const stranded = await flowStore.getFlowRun("task-1", "loop-recover");
        if (!stranded) throw new Error("expected a run");
        stranded.status = "paused";
        stranded.actions[stranded.currentActionIndex].status = "failed";
        stranded.actions[stranded.currentActionIndex].sessionId = undefined;
        await flowStore.saveFlowRun(stranded);

        await runner.resumeFlow("task-1", "loop-recover");

        const run = await flowStore.getFlowRun("task-1", "loop-recover");
        expect(run?.status).toBe("running");
        expect(run?.loop).toBe(true);
        expect(run?.iteration).toBe(2);
        expect(run?.currentActionIndex).toBe(0);
    });
});
