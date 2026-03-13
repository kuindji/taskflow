import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { FlowStore } from "../flow-store";
import { FlowRunner } from "../flow-runner";
import type { FlowDefinition } from "@taskflow/shared";

describe("flow lifecycle integration", () => {
    let tempDir: string;
    let flowStore: FlowStore;
    let runner: FlowRunner;
    let spawnedSessions: Array<{ sessionId: string; taskId: string; prompt: string }>;
    let closedSessions: string[];
    let broadcasts: Array<{ type: string; payload: unknown }>;

    const testFlow: FlowDefinition = {
        id: "flow-1",
        name: "Test Flow",
        description: "Integration test flow",
        steps: [
            {
                id: "e1",
                inline: { name: "Step 1", prompt: "Do first", sessionType: "claude" },
            },
            {
                id: "e2",
                inline: { name: "Step 2", prompt: "Do second", sessionType: "claude" },
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
                    taskId: opts.taskId,
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
            getTaskDescription: async () => "Test task description",
        });
    });

    afterEach(async () => {
        await rm(tempDir, { recursive: true, force: true });
    });

    test("full flow runs to completion", async () => {
        await runner.startFlow("task-1", testFlow);
        expect(spawnedSessions).toHaveLength(1);

        // Complete step 1
        await runner.handleStepComplete("task-1", "flow-1", "session-1");
        expect(spawnedSessions).toHaveLength(2);

        // Complete step 2
        await runner.handleStepComplete("task-1", "flow-1", "session-2");

        const run = await flowStore.getFlowRun("task-1", "flow-1");
        expect(run).not.toBeNull();
        expect(run!.status).toBe("completed");
        expect(run!.steps.every((s) => s.status === "completed")).toBe(true);
    });

    test("artifacts persist across steps", async () => {
        await runner.startFlow("task-1", testFlow);

        // Save artifact in step 1
        await runner.saveArtifact("task-1", "flow-1", "e1", "session-1", {
            type: "plan",
            path: "docs/plan.md",
        });

        // Complete step 1
        await runner.handleStepComplete("task-1", "flow-1", "session-1");

        // Verify artifact persists after advancing
        const run = await flowStore.getFlowRun("task-1", "flow-1");
        expect(run).not.toBeNull();
        const artifacts = runner.getArtifacts(run!, "plan");
        expect(artifacts).toHaveLength(1);
        expect(artifacts[0].path).toBe("docs/plan.md");
    });

    test("pause and resume preserves state", async () => {
        await runner.startFlow("task-1", testFlow);
        expect(spawnedSessions).toHaveLength(1);

        // Pause
        await runner.pauseFlow("task-1", "flow-1");
        let run = await flowStore.getFlowRun("task-1", "flow-1");
        expect(run!.status).toBe("paused");
        expect(run!.steps[0].sessionId).toBeUndefined();
        expect(closedSessions).toEqual(["session-1"]);

        // Resume
        await runner.resumeFlow("task-1", "flow-1");
        run = await flowStore.getFlowRun("task-1", "flow-1");
        expect(run!.status).toBe("running");
        expect(run!.steps[0].sessionId).toBe("session-2");
        expect(spawnedSessions).toHaveLength(2);
    });

    test("skip step advances to next", async () => {
        await runner.startFlow("task-1", testFlow);
        expect(spawnedSessions).toHaveLength(1);

        // Skip step 1
        await runner.skipStep("task-1", "flow-1");

        const run = await flowStore.getFlowRun("task-1", "flow-1");
        expect(run).not.toBeNull();
        expect(run!.steps[0].status).toBe("skipped");
        expect(run!.currentStepIndex).toBe(1);
        // Should have spawned a session for step 2
        expect(spawnedSessions).toHaveLength(2);
    });

    test("jumping backward from an active later step resets later state", async () => {
        await runner.startFlow("task-1", testFlow);

        // Advance into step 2 so the later step is actively running.
        await runner.handleStepComplete("task-1", "flow-1", "session-1");

        let run = await flowStore.getFlowRun("task-1", "flow-1");
        expect(run!.status).toBe("running");
        expect(run!.currentStepIndex).toBe(1);
        expect(run!.steps[1].status).toBe("running");
        expect(run!.steps[1].sessionId).toBe("session-2");

        // Jump back to step 0
        await runner.jumpToStep("task-1", "flow-1", 0);

        run = await flowStore.getFlowRun("task-1", "flow-1");
        expect(run!.status).toBe("running");
        expect(run!.currentStepIndex).toBe(0);
        expect(run!.steps[0].status).toBe("running");
        expect(run!.steps[0].sessionId).toBe("session-3");
        // Later steps should be reset to pending
        expect(run!.steps[1].status).toBe("pending");
        expect(run!.steps[1].sessionId).toBeUndefined();
        expect(run!.steps.filter((step) => step.status === "running")).toHaveLength(1);
        expect(closedSessions).toEqual(["session-2"]);
    });

    test("stop flow marks it as failed", async () => {
        await runner.startFlow("task-1", testFlow);

        await runner.stopFlow("task-1", "flow-1");

        const run = await flowStore.getFlowRun("task-1", "flow-1");
        expect(run!.status).toBe("failed");
    });

    test("flow run persists to disk and survives reload", async () => {
        await runner.startFlow("task-1", testFlow);
        await runner.handleStepComplete("task-1", "flow-1", "session-1");

        // Create a new FlowStore pointing at same directory
        const freshStore = new FlowStore(join(tempDir, "flows"), join(tempDir, "flow-runs"));
        await freshStore.init();

        const run = await freshStore.getFlowRun("task-1", "flow-1");
        expect(run).not.toBeNull();
        expect(run!.status).toBe("running");
        expect(run!.steps[0].status).toBe("completed");
        expect(run!.steps[1].status).toBe("running");
        expect(run!.currentStepIndex).toBe(1);
    });

    test("shell steps auto-complete on clean exit and advance the flow", async () => {
        const shellFlow: FlowDefinition = {
            ...testFlow,
            steps: [
                {
                    id: "e1",
                    inline: { name: "Lint", prompt: "bun run lint", sessionType: "shell" },
                },
                testFlow.steps[1],
            ],
        };
        await flowStore.saveFlow(shellFlow);

        await runner.startFlow("task-1", shellFlow);
        expect(spawnedSessions).toHaveLength(1);

        await runner.handleSessionExit("session-1", 0);

        const run = await flowStore.getFlowRun("task-1", "flow-1");
        expect(run).not.toBeNull();
        expect(run!.status).toBe("running");
        expect(run!.steps[0].status).toBe("completed");
        expect(run!.steps[1].status).toBe("running");
        expect(run!.steps[1].sessionId).toBe("session-2");
        expect(spawnedSessions).toHaveLength(2);
    });
});
