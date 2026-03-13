import type {
    AgentLaunchOptions,
    FlowDefinition,
    FlowRun,
    FlowStepEntry,
    FlowArtifact,
    SessionType,
} from "@taskflow/shared";
import { MSG } from "@taskflow/shared";
import type { FlowStore } from "./flow-store";

interface SpawnSessionOpts {
    taskId: string;
    sessionType: SessionType;
    prompt: string;
    label: string;
    agentOptions?: AgentLaunchOptions;
    flowId: string;
    stepEntryId: string;
}

interface FlowRunnerDeps {
    flowStore: FlowStore;
    spawnSession: (opts: SpawnSessionOpts) => Promise<string>;
    closeSession: (sessionId: string) => void;
    broadcast: (msg: { type: string; payload: unknown }) => void;
    getTaskDescription: (taskId: string) => Promise<string>;
}

class FlowRunner {
    private deps: FlowRunnerDeps;
    // Maps sessionId → { taskId, flowId } for exit handling
    private sessionFlowMap = new Map<string, { taskId: string; flowId: string }>();

    constructor(deps: FlowRunnerDeps) {
        this.deps = deps;
    }

    async startFlow(taskId: string, flow: FlowDefinition): Promise<FlowRun> {
        const existingRuns = await this.deps.flowStore.getFlowRunsForTask(taskId);
        const activeRun = existingRuns.find(
            (r) => r.status === "running" || r.status === "paused",
        );
        if (activeRun) {
            throw new Error(`Task already has an active flow: ${activeRun.flowId}`);
        }

        // Overwrite only terminal runs; active runs are blocked above
        const existingRun = await this.deps.flowStore.getFlowRun(taskId, flow.id);
        if (existingRun) {
            if (existingRun.status === "running" || existingRun.status === "paused") {
                throw new Error(`Flow "${flow.id}" is still active on task "${taskId}"`);
            }
            await this.deps.flowStore.deleteFlowRun(taskId, flow.id);
        }

        const run: FlowRun = {
            taskId,
            flowId: flow.id,
            status: "running",
            currentStepIndex: 0,
            steps: flow.steps.map((s) => ({
                stepEntryId: s.id,
                status: "pending",
            })),
            artifacts: [],
            startedAt: new Date().toISOString(),
        };

        run.steps[0].status = "running";
        run.steps[0].startedAt = new Date().toISOString();
        await this.deps.flowStore.saveFlowRun(run);
        this.broadcastUpdate(run);

        await this.launchStep(taskId, flow, run, 0);
        return run;
    }

    async handleStepComplete(
        taskId: string,
        flowId: string,
        sessionId: string,
    ): Promise<void> {
        const run = await this.deps.flowStore.getFlowRun(taskId, flowId);
        if (!run || run.status !== "running") return;

        const currentStep = run.steps[run.currentStepIndex];
        if (!currentStep || currentStep.sessionId !== sessionId) return;

        currentStep.status = "completed";
        currentStep.completedAt = new Date().toISOString();
        this.sessionFlowMap.delete(sessionId);

        await this.advanceOrComplete(run);
    }

    async skipStep(taskId: string, flowId: string): Promise<void> {
        const run = await this.deps.flowStore.getFlowRun(taskId, flowId);
        if (!run || run.status !== "running") return;

        const currentStep = run.steps[run.currentStepIndex];
        if (currentStep) {
            if (currentStep.sessionId) {
                this.deps.closeSession(currentStep.sessionId);
                this.sessionFlowMap.delete(currentStep.sessionId);
            }
            currentStep.status = "skipped";
            currentStep.completedAt = new Date().toISOString();
        }

        await this.advanceOrComplete(run);
    }

    async jumpToStep(
        taskId: string,
        flowId: string,
        targetIndex: number,
    ): Promise<void> {
        const run = await this.deps.flowStore.getFlowRun(taskId, flowId);
        if (!run) return;

        if (targetIndex < 0 || targetIndex >= run.steps.length) {
            throw new Error(`Invalid step index: ${targetIndex}`);
        }

        const currentStep = run.steps[run.currentStepIndex];
        if (currentStep?.sessionId) {
            this.deps.closeSession(currentStep.sessionId);
            this.sessionFlowMap.delete(currentStep.sessionId);
        }

        // Forward jump — skip intermediate steps
        if (targetIndex > run.currentStepIndex) {
            for (let i = run.currentStepIndex; i < targetIndex; i++) {
                if (
                    run.steps[i].status === "running" ||
                    run.steps[i].status === "pending"
                ) {
                    run.steps[i].status = "skipped";
                    run.steps[i].completedAt = new Date().toISOString();
                }
            }
        }

        run.currentStepIndex = targetIndex;
        run.steps[targetIndex].status = "running";
        run.steps[targetIndex].startedAt = new Date().toISOString();
        run.steps[targetIndex].completedAt = undefined;
        run.steps[targetIndex].sessionId = undefined;
        run.artifacts = run.artifacts.filter(
            (artifact) => artifact.stepEntryId !== run.steps[targetIndex].stepEntryId,
        );
        run.status = "running";

        await this.deps.flowStore.saveFlowRun(run);
        this.broadcastUpdate(run);

        const flow = await this.resolveFlowDefinition(flowId);
        if (flow) {
            await this.launchStep(taskId, flow, run, targetIndex);
        }
    }

    async pauseFlow(taskId: string, flowId: string): Promise<void> {
        const run = await this.deps.flowStore.getFlowRun(taskId, flowId);
        if (!run || run.status !== "running") return;

        run.status = "paused";
        await this.deps.flowStore.saveFlowRun(run);
        this.broadcastUpdate(run);
    }

    async resumeFlow(taskId: string, flowId: string): Promise<void> {
        const run = await this.deps.flowStore.getFlowRun(taskId, flowId);
        if (!run || run.status !== "paused") return;

        run.status = "running";
        run.steps[run.currentStepIndex].status = "running";
        run.steps[run.currentStepIndex].startedAt = new Date().toISOString();
        run.steps[run.currentStepIndex].completedAt = undefined;
        run.steps[run.currentStepIndex].sessionId = undefined;
        run.artifacts = run.artifacts.filter(
            (artifact) =>
                artifact.stepEntryId !== run.steps[run.currentStepIndex].stepEntryId,
        );
        await this.deps.flowStore.saveFlowRun(run);
        this.broadcastUpdate(run);

        const flow = await this.resolveFlowDefinition(flowId);
        if (flow) {
            await this.launchStep(run.taskId, flow, run, run.currentStepIndex);
        }
    }

    async stopFlow(taskId: string, flowId: string): Promise<void> {
        const run = await this.deps.flowStore.getFlowRun(taskId, flowId);
        if (!run) return;
        await this.failFlow(run);
    }

    async handleSessionExit(sessionId: string, exitCode: number): Promise<void> {
        const mapping = this.sessionFlowMap.get(sessionId);
        if (!mapping) return;

        const { taskId, flowId } = mapping;
        const run = await this.deps.flowStore.getFlowRun(taskId, flowId);
        if (!run) return;

        const currentStep = run.steps[run.currentStepIndex];
        if (!currentStep || currentStep.sessionId !== sessionId) return;

        // Already completed via step complete signal — ignore
        if (currentStep.status === "completed" || currentStep.status === "skipped") {
            this.sessionFlowMap.delete(sessionId);
            return;
        }

        // Resolve step to check session type
        const flow = await this.resolveFlowDefinition(flowId);
        const stepEntry = flow?.steps[run.currentStepIndex];
        const sessionType = this.getSessionType(stepEntry);

        if (sessionType === "shell" && exitCode === 0) {
            // Shell steps auto-complete on clean exit
            currentStep.status = "completed";
            currentStep.completedAt = new Date().toISOString();
            this.sessionFlowMap.delete(sessionId);
            await this.advanceOrComplete(run);
        } else if (run.status === "paused") {
            // Flow was paused — don't mark as failed, just clean up
            this.sessionFlowMap.delete(sessionId);
        } else {
            // Agent exited without signaling complete — fail the step, pause the flow
            currentStep.status = "failed";
            currentStep.completedAt = new Date().toISOString();
            run.status = "paused";
            this.sessionFlowMap.delete(sessionId);
            await this.deps.flowStore.saveFlowRun(run);
            this.broadcastUpdate(run);
        }
    }

    async saveArtifact(
        taskId: string,
        flowId: string,
        stepEntryId: string,
        artifact: Omit<FlowArtifact, "stepEntryId" | "createdAt">,
    ): Promise<void> {
        const run = await this.deps.flowStore.getFlowRun(taskId, flowId);
        if (!run) throw new Error("No flow run found");

        // Re-saving the same artifact type for the same step replaces the older value
        run.artifacts = run.artifacts.filter(
            (existing) =>
                !(existing.stepEntryId === stepEntryId && existing.type === artifact.type),
        );

        run.artifacts.push({
            ...artifact,
            stepEntryId,
            createdAt: new Date().toISOString(),
        });
        await this.deps.flowStore.saveFlowRun(run);
        this.broadcastUpdate(run);
    }

    getArtifacts(run: FlowRun, type?: string): FlowArtifact[] {
        const artifacts = type
            ? run.artifacts.filter((a) => a.type === type)
            : run.artifacts;
        return artifacts.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    }

    // --- Private helpers ---

    private async failFlow(run: FlowRun): Promise<void> {
        const currentStep = run.steps[run.currentStepIndex];
        if (currentStep?.sessionId) {
            this.deps.closeSession(currentStep.sessionId);
            this.sessionFlowMap.delete(currentStep.sessionId);
        }
        if (currentStep?.status === "running") {
            currentStep.status = "failed";
            currentStep.completedAt = new Date().toISOString();
        }

        run.status = "failed";
        run.completedAt = new Date().toISOString();
        await this.deps.flowStore.saveFlowRun(run);
        this.broadcastUpdate(run);
    }

    private async advanceOrComplete(run: FlowRun): Promise<void> {
        const nextIndex = run.currentStepIndex + 1;
        if (nextIndex >= run.steps.length) {
            run.status = "completed";
            run.completedAt = new Date().toISOString();
            await this.deps.flowStore.saveFlowRun(run);
            this.broadcastUpdate(run);
            return;
        }

        run.currentStepIndex = nextIndex;
        run.steps[nextIndex].status = "running";
        run.steps[nextIndex].startedAt = new Date().toISOString();
        await this.deps.flowStore.saveFlowRun(run);
        this.broadcastUpdate(run);

        const flow = await this.resolveFlowDefinition(run.flowId);
        if (flow) {
            await this.launchStep(run.taskId, flow, run, nextIndex);
        }
    }

    private async launchStep(
        taskId: string,
        flow: FlowDefinition,
        run: FlowRun,
        stepIndex: number,
    ): Promise<void> {
        const stepEntry = flow.steps[stepIndex];
        if (!stepEntry) return;

        const resolved = await this.resolveStep(stepEntry);
        const taskDescription = await this.deps.getTaskDescription(taskId);
        const prompt = this.buildStepPrompt(
            resolved.prompt,
            taskDescription,
            resolved.sessionType,
        );

        const sessionId = await this.deps.spawnSession({
            taskId,
            sessionType: resolved.sessionType,
            prompt,
            label: stepEntry.label ?? resolved.name,
            agentOptions: resolved.agentOptions,
            flowId: flow.id,
            stepEntryId: stepEntry.id,
        });

        this.sessionFlowMap.set(sessionId, { taskId, flowId: flow.id });
        run.steps[stepIndex].sessionId = sessionId;
        await this.deps.flowStore.saveFlowRun(run);
    }

    private async resolveStep(entry: FlowStepEntry): Promise<{
        name: string;
        prompt: string;
        sessionType: SessionType;
        agentOptions?: AgentLaunchOptions;
    }> {
        if (entry.inline) {
            return entry.inline;
        }
        if (entry.stepId) {
            const steps = await this.deps.flowStore.getSteps();
            const step = steps.find((s) => s.id === entry.stepId);
            if (!step) throw new Error(`Step definition not found: ${entry.stepId}`);
            return step;
        }
        throw new Error(`FlowStepEntry has neither stepId nor inline: ${entry.id}`);
    }

    private getSessionType(stepEntry?: FlowStepEntry): SessionType | undefined {
        if (!stepEntry) return undefined;
        if (stepEntry.inline) return stepEntry.inline.sessionType;
        // For referenced steps we'd need an async lookup, but the caller
        // already resolved the flow so we can check inline directly.
        // Referenced steps are resolved during launchStep.
        return undefined;
    }

    private async resolveFlowDefinition(
        flowId: string,
    ): Promise<FlowDefinition | null> {
        const flows = await this.deps.flowStore.getFlows();
        return flows.find((f) => f.id === flowId) ?? null;
    }

    private buildStepPrompt(
        stepPrompt: string,
        taskDescription: string,
        sessionType: SessionType,
    ): string {
        if (sessionType === "shell") {
            return stepPrompt;
        }
        return [
            `## Task Description\n\n${taskDescription}`,
            `## Step Instructions\n\n${stepPrompt}`,
            `## Taskflow CLI`,
            `Use \`taskflow-cli task\` to read task info and logs.`,
            `Use \`taskflow-cli artifact list\` to see available artifacts from prior steps.`,
            `Use \`taskflow-cli artifact get <type>\` to retrieve a specific artifact.`,
            `When you have completed this step, run \`taskflow-cli step complete\`.`,
        ].join("\n\n");
    }

    private broadcastUpdate(run: FlowRun): void {
        this.deps.broadcast({
            type: MSG.FLOW_RUN_UPDATED,
            payload: run,
        });
    }
}

export { FlowRunner };
export type { SpawnSessionOpts, FlowRunnerDeps };
