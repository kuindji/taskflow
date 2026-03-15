import type {
    AgentLaunchOptions,
    FlowDefinition,
    FlowRun,
    FlowActionEntry,
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
    actionEntryId: string;
}

interface FlowRunnerDeps {
    flowStore: FlowStore;
    spawnSession: (opts: SpawnSessionOpts) => Promise<string>;
    closeSession: (sessionId: string) => void;
    broadcast: (msg: { type: string; payload: unknown }) => void;
    getTaskDescription: (taskId: string) => Promise<string>;
}

interface SessionFlowMapping {
    taskId: string;
    flowId: string;
    actionEntryId: string;
    sessionType: SessionType;
}

class FlowRunner {
    private deps: FlowRunnerDeps;
    // Maps sessionId → flow metadata for exit handling
    private sessionFlowMap = new Map<string, SessionFlowMapping>();

    constructor(deps: FlowRunnerDeps) {
        this.deps = deps;
    }

    async startFlow(taskId: string, flow: FlowDefinition): Promise<FlowRun> {
        if (flow.actions.length === 0) {
            throw new Error(`Flow "${flow.id}" must define at least one action`);
        }

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
            currentActionIndex: 0,
            actions: flow.actions.map((s) => ({
                actionEntryId: s.id,
                status: "pending",
            })),
            artifacts: [],
            startedAt: new Date().toISOString(),
        };

        run.actions[0].status = "running";
        run.actions[0].startedAt = new Date().toISOString();
        await this.deps.flowStore.saveFlowRun(run);
        this.broadcastUpdate(run);

        await this.launchActionWithRecovery(taskId, flow, run, 0);
        return run;
    }

    async handleActionComplete(
        taskId: string,
        flowId: string,
        sessionId: string,
    ): Promise<void> {
        const run = await this.deps.flowStore.getFlowRun(taskId, flowId);
        if (!run || run.status !== "running") return;

        const currentAction = run.actions[run.currentActionIndex];
        if (!currentAction || currentAction.sessionId !== sessionId) return;

        currentAction.status = "completed";
        currentAction.completedAt = new Date().toISOString();
        this.sessionFlowMap.delete(sessionId);

        await this.advanceOrComplete(run);
    }

    async skipAction(taskId: string, flowId: string): Promise<void> {
        const run = await this.deps.flowStore.getFlowRun(taskId, flowId);
        if (!run || run.status !== "running") return;

        const currentAction = run.actions[run.currentActionIndex];
        if (currentAction) {
            if (currentAction.sessionId) {
                this.deps.closeSession(currentAction.sessionId);
                this.sessionFlowMap.delete(currentAction.sessionId);
                currentAction.sessionId = undefined;
            }
            currentAction.status = "skipped";
            currentAction.completedAt = new Date().toISOString();
        }

        await this.advanceOrComplete(run);
    }

    async jumpToAction(
        taskId: string,
        flowId: string,
        targetIndex: number,
    ): Promise<void> {
        const run = await this.deps.flowStore.getFlowRun(taskId, flowId);
        if (!run) return;

        if (targetIndex < 0 || targetIndex >= run.actions.length) {
            throw new Error(`Invalid action index: ${targetIndex}`);
        }

        const currentActionIndex = run.currentActionIndex;
        const currentAction = run.actions[currentActionIndex];
        if (currentAction?.sessionId) {
            this.deps.closeSession(currentAction.sessionId);
            this.sessionFlowMap.delete(currentAction.sessionId);
            currentAction.sessionId = undefined;
        }

        for (let i = targetIndex; i < run.actions.length; i++) {
            this.resetActionState(run.actions[i]);
        }

        if (targetIndex > currentActionIndex) {
            const skippedAt = new Date().toISOString();
            for (let i = currentActionIndex; i < targetIndex; i++) {
                if (
                    run.actions[i].status === "running" ||
                    run.actions[i].status === "pending"
                ) {
                    run.actions[i].status = "skipped";
                    run.actions[i].completedAt = skippedAt;
                    run.actions[i].sessionId = undefined;
                }
            }
        }

        run.currentActionIndex = targetIndex;
        run.actions[targetIndex].status = "running";
        run.actions[targetIndex].startedAt = new Date().toISOString();

        const resetActionEntryIds = new Set(
            run.actions.slice(targetIndex).map((action) => action.actionEntryId),
        );
        run.artifacts = run.artifacts.filter(
            (artifact) => !resetActionEntryIds.has(artifact.actionEntryId),
        );
        run.status = "running";

        await this.deps.flowStore.saveFlowRun(run);
        this.broadcastUpdate(run);

        await this.launchPersistedActionWithRecovery(taskId, flowId, run, targetIndex);
    }

    async pauseFlow(taskId: string, flowId: string): Promise<void> {
        const run = await this.deps.flowStore.getFlowRun(taskId, flowId);
        if (!run || run.status !== "running") return;

        const currentAction = run.actions[run.currentActionIndex];
        if (currentAction?.sessionId) {
            this.deps.closeSession(currentAction.sessionId);
            this.sessionFlowMap.delete(currentAction.sessionId);
            currentAction.sessionId = undefined;
        }

        run.status = "paused";
        await this.deps.flowStore.saveFlowRun(run);
        this.broadcastUpdate(run);
    }

    async resumeFlow(taskId: string, flowId: string): Promise<void> {
        const run = await this.deps.flowStore.getFlowRun(taskId, flowId);
        if (!run || run.status !== "paused") return;

        run.status = "running";
        run.actions[run.currentActionIndex].status = "running";
        run.actions[run.currentActionIndex].startedAt = new Date().toISOString();
        run.actions[run.currentActionIndex].completedAt = undefined;
        run.actions[run.currentActionIndex].sessionId = undefined;
        run.artifacts = run.artifacts.filter(
            (artifact) =>
                artifact.actionEntryId !== run.actions[run.currentActionIndex].actionEntryId,
        );
        await this.deps.flowStore.saveFlowRun(run);
        this.broadcastUpdate(run);

        await this.launchPersistedActionWithRecovery(
            run.taskId,
            flowId,
            run,
            run.currentActionIndex,
        );
    }

    async stopFlow(taskId: string, flowId: string): Promise<void> {
        const run = await this.deps.flowStore.getFlowRun(taskId, flowId);
        if (!run) return;
        await this.failFlow(run);
    }

    async handleSessionExit(sessionId: string, exitCode: number): Promise<void> {
        const mapping = this.sessionFlowMap.get(sessionId);
        if (!mapping) return;

        const { taskId, flowId, sessionType } = mapping;
        const run = await this.deps.flowStore.getFlowRun(taskId, flowId);
        if (!run) return;

        const currentAction = run.actions[run.currentActionIndex];
        if (!currentAction || currentAction.sessionId !== sessionId) return;

        // Already completed via action complete signal — ignore
        if (currentAction.status === "completed" || currentAction.status === "skipped") {
            this.sessionFlowMap.delete(sessionId);
            return;
        }

        if (sessionType === "shell" && exitCode === 0) {
            // Shell actions auto-complete on clean exit
            currentAction.status = "completed";
            currentAction.completedAt = new Date().toISOString();
            this.sessionFlowMap.delete(sessionId);
            await this.advanceOrComplete(run);
        } else if (run.status === "paused") {
            // Flow was paused — don't mark as failed, just clean up
            this.sessionFlowMap.delete(sessionId);
        } else {
            // Agent exited without signaling complete — fail the action, pause the flow
            currentAction.status = "failed";
            currentAction.completedAt = new Date().toISOString();
            run.status = "paused";
            this.sessionFlowMap.delete(sessionId);
            await this.deps.flowStore.saveFlowRun(run);
            this.broadcastUpdate(run);
        }
    }

    async saveArtifact(
        taskId: string,
        flowId: string,
        actionEntryId: string,
        sessionId: string,
        artifact: Omit<FlowArtifact, "actionEntryId" | "createdAt">,
    ): Promise<void> {
        const run = await this.deps.flowStore.getFlowRun(taskId, flowId);
        if (!run) throw new Error("No flow run found");
        if (run.status !== "running") throw new Error("Flow run is not active");

        const currentAction = run.actions[run.currentActionIndex];
        if (!currentAction || currentAction.status !== "running") {
            throw new Error("No running action available for artifact save");
        }
        if (currentAction.actionEntryId !== actionEntryId) {
            throw new Error("Artifacts can only be saved for the current action");
        }
        if (!currentAction.sessionId || currentAction.sessionId !== sessionId) {
            throw new Error("Artifacts can only be saved by the active action session");
        }

        const hasPath = artifact.path !== undefined;
        const hasText = artifact.text !== undefined;
        if (hasPath === hasText) {
            throw new Error("Artifact must include exactly one of path or text");
        }

        // Re-saving the same artifact type for the same action replaces the older value
        run.artifacts = run.artifacts.filter(
            (existing) =>
                !(existing.actionEntryId === actionEntryId && existing.type === artifact.type),
        );

        run.artifacts.push({
            ...artifact,
            actionEntryId,
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

    async failFlowByIds(taskId: string, flowId: string): Promise<void> {
        const run = await this.deps.flowStore.getFlowRun(taskId, flowId);
        if (!run) return;
        await this.failFlow(run);
    }

    // --- Private helpers ---

    private async failFlow(run: FlowRun): Promise<void> {
        const currentAction = run.actions[run.currentActionIndex];
        if (currentAction?.sessionId) {
            this.deps.closeSession(currentAction.sessionId);
            this.sessionFlowMap.delete(currentAction.sessionId);
            currentAction.sessionId = undefined;
        }
        if (currentAction?.status === "running") {
            currentAction.status = "failed";
            currentAction.completedAt = new Date().toISOString();
        }

        run.status = "failed";
        run.completedAt = new Date().toISOString();
        await this.deps.flowStore.saveFlowRun(run);
        this.broadcastUpdate(run);
    }

    private async advanceOrComplete(run: FlowRun): Promise<void> {
        const nextIndex = run.currentActionIndex + 1;
        if (nextIndex >= run.actions.length) {
            run.status = "completed";
            run.completedAt = new Date().toISOString();
            await this.deps.flowStore.saveFlowRun(run);
            this.broadcastUpdate(run);
            return;
        }

        run.currentActionIndex = nextIndex;
        run.actions[nextIndex].status = "running";
        run.actions[nextIndex].startedAt = new Date().toISOString();
        await this.deps.flowStore.saveFlowRun(run);
        this.broadcastUpdate(run);

        await this.launchPersistedActionWithRecovery(run.taskId, run.flowId, run, nextIndex);
    }

    private async launchAction(
        taskId: string,
        flow: FlowDefinition,
        run: FlowRun,
        actionIndex: number,
    ): Promise<void> {
        const actionEntry = flow.actions[actionIndex];
        if (!actionEntry) return;

        const resolved = await this.resolveAction(actionEntry);
        const taskDescription = await this.deps.getTaskDescription(taskId);
        const prompt = this.buildActionPrompt(
            resolved.prompt,
            taskDescription,
            resolved.sessionType,
        );

        const sessionId = await this.deps.spawnSession({
            taskId,
            sessionType: resolved.sessionType,
            prompt,
            label: actionEntry.label ?? resolved.name,
            agentOptions: resolved.agentOptions,
            flowId: flow.id,
            actionEntryId: actionEntry.id,
        });

        this.sessionFlowMap.set(sessionId, {
            taskId,
            flowId: flow.id,
            actionEntryId: actionEntry.id,
            sessionType: resolved.sessionType,
        });
        run.actions[actionIndex].sessionId = sessionId;
        await this.deps.flowStore.saveFlowRun(run);
    }

    private async launchActionWithRecovery(
        taskId: string,
        flow: FlowDefinition,
        run: FlowRun,
        actionIndex: number,
    ): Promise<void> {
        try {
            await this.launchAction(taskId, flow, run, actionIndex);
        } catch (error) {
            await this.markActionLaunchFailed(run, actionIndex);
            throw error;
        }
    }

    private async launchPersistedActionWithRecovery(
        taskId: string,
        flowId: string,
        run: FlowRun,
        actionIndex: number,
    ): Promise<void> {
        try {
            const flow = await this.requireFlowDefinition(flowId);
            await this.launchAction(taskId, flow, run, actionIndex);
        } catch (error) {
            await this.markActionLaunchFailed(run, actionIndex);
            throw error;
        }
    }

    private async resolveAction(entry: FlowActionEntry): Promise<{
        name: string;
        prompt: string;
        sessionType: SessionType;
        agentOptions?: AgentLaunchOptions;
    }> {
        if (entry.inline) {
            return entry.inline;
        }
        if (entry.actionId) {
            const actions = await this.deps.flowStore.getActions();
            const action = actions.find((s) => s.id === entry.actionId);
            if (!action) throw new Error(`Action definition not found: ${entry.actionId}`);
            return action;
        }
        throw new Error(`FlowActionEntry has neither actionId nor inline: ${entry.id}`);
    }

    private async resolveFlowDefinition(
        flowId: string,
    ): Promise<FlowDefinition | null> {
        const flows = await this.deps.flowStore.getFlows();
        return flows.find((f) => f.id === flowId) ?? null;
    }

    private async requireFlowDefinition(flowId: string): Promise<FlowDefinition> {
        const flow = await this.resolveFlowDefinition(flowId);
        if (!flow) {
            throw new Error(`Flow definition not found: ${flowId}`);
        }
        return flow;
    }

    private async markActionLaunchFailed(
        run: FlowRun,
        actionIndex: number,
    ): Promise<void> {
        const action = run.actions[actionIndex];
        if (action) {
            action.status = "failed";
            action.completedAt = new Date().toISOString();
            action.sessionId = undefined;
        }
        run.status = "paused";
        await this.deps.flowStore.saveFlowRun(run);
        this.broadcastUpdate(run);
    }

    private resetActionState(action: FlowRun["actions"][number]): void {
        action.status = "pending";
        action.sessionId = undefined;
        action.startedAt = undefined;
        action.completedAt = undefined;
    }

    private buildActionPrompt(
        actionPrompt: string,
        taskDescription: string,
        sessionType: SessionType,
    ): string {
        if (sessionType === "shell") {
            return actionPrompt;
        }
        return [
            `## Task Description\n\n${taskDescription}`,
            `## Action Instructions\n\n${actionPrompt}`,
            `## Taskflow CLI`,
            `Use \`taskflow-cli task\` to read task info and logs.`,
            `Use \`taskflow-cli artifact list\` to see available artifacts from prior actions.`,
            `Use \`taskflow-cli artifact get <type>\` to retrieve a specific artifact.`,
            `When you have completed this action, run \`taskflow-cli action complete\`.`,
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
