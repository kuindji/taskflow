import type {
    AgentLaunchOptions,
    FlowDefinition,
    FlowOwner,
    FlowRun,
    FlowActionEntry,
    FlowActionStatus,
    FlowArtifact,
    SessionType,
} from "@taskflow/shared";
import { MASTER_OWNER_ID, MSG, isAgentType } from "@taskflow/shared";
import type { FlowStore } from "./flow-store";

interface SpawnSessionOpts {
    owner: FlowOwner;
    sessionType: SessionType;
    prompt: string;
    systemPrompt?: string;
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
    getOwnerDescription: (owner: FlowOwner) => Promise<string>;
}

interface SessionFlowMapping {
    ownerId: string;
    owner: FlowOwner;
    flowId: string;
    actionEntryId: string;
    sessionType: SessionType;
}

interface EndRunOptions {
    status: "completed" | "failed";
    // Applied only to a step whose status is currently "running". Restricted to
    // terminal outcomes: the run is ending, so leaving a step "running" or
    // "pending" would persist a finished run with an active-looking step.
    runningStepOutcome: Extract<FlowActionStatus, "completed" | "skipped" | "failed">;
    // When true, every still-pending step is marked skipped
    skipPending: boolean;
}

class FlowRunner {
    private deps: FlowRunnerDeps;
    // Maps sessionId → flow metadata for exit handling
    private sessionFlowMap = new Map<string, SessionFlowMapping>();
    private ownerLocks = new Map<string, Promise<void>>();

    constructor(deps: FlowRunnerDeps) {
        this.deps = deps;
    }

    private async withOwnerLock<T>(ownerId: string, fn: () => Promise<T>): Promise<T> {
        const previous = this.ownerLocks.get(ownerId) ?? Promise.resolve();
        let release!: () => void;
        const gate = new Promise<void>((resolve) => {
            release = resolve;
        });
        const queued = previous.catch(() => undefined).then(() => gate);
        this.ownerLocks.set(ownerId, queued);
        await previous.catch(() => undefined);
        try {
            return await fn();
        } finally {
            release();
            if (this.ownerLocks.get(ownerId) === queued) {
                this.ownerLocks.delete(ownerId);
            }
        }
    }

    async startFlow(
        owner: FlowOwner,
        flow: FlowDefinition,
        inputValues?: Record<string, string>,
    ): Promise<FlowRun> {
        if (flow.actions.length === 0) {
            throw new Error(`Flow "${flow.id}" must define at least one action`);
        }

        if (flow.inputs && flow.inputs.length > 0) {
            for (const input of flow.inputs) {
                const value = inputValues?.[input.id];
                if (typeof value !== "string" || value.trim().length === 0) {
                    throw new Error(`Missing required flow input: "${input.id}"`);
                }
            }
        }

        const ownerId = this.getOwnerId(owner);

        return this.withOwnerLock(ownerId, async () => {
            const existingRuns = await this.deps.flowStore.getFlowRunsForOwner(ownerId);
            const activeRun = existingRuns.find(
                (r) => r.status === "running" || r.status === "paused",
            );
            if (activeRun) {
                throw new Error(`Owner already has an active flow: ${activeRun.flowId}`);
            }

            // Overwrite only terminal runs; active runs are blocked above
            const existingRun = await this.deps.flowStore.getFlowRun(ownerId, flow.id);
            if (existingRun) {
                if (existingRun.status === "running" || existingRun.status === "paused") {
                    throw new Error(`Flow "${flow.id}" is still active on owner "${ownerId}"`);
                }
                await this.deps.flowStore.deleteFlowRun(ownerId, flow.id);
            }

            const run: FlowRun = {
                ...owner,
                flowId: flow.id,
                status: "running",
                currentActionIndex: 0,
                actions: flow.actions.map((s) => ({
                    actionEntryId: s.id,
                    status: "pending",
                })),
                artifacts: [],
                inputValues: flow.inputs && flow.inputs.length > 0 ? inputValues : undefined,
                startedAt: new Date().toISOString(),
            };

            run.actions[0].status = "running";
            run.actions[0].startedAt = new Date().toISOString();
            await this.deps.flowStore.saveFlowRun(run);
            this.broadcastUpdate(run);

            await this.launchActionWithRecovery(owner, flow, run, 0);
            return run;
        });
    }

    async handleActionComplete(ownerId: string, flowId: string, sessionId: string): Promise<void> {
        const run = await this.deps.flowStore.getFlowRun(ownerId, flowId);
        if (!run || run.status !== "running") return;

        const currentAction = run.actions[run.currentActionIndex];
        if (!currentAction || currentAction.sessionId !== sessionId) return;

        currentAction.status = "completed";
        currentAction.completedAt = new Date().toISOString();
        this.sessionFlowMap.delete(sessionId);

        await this.advanceOrComplete(run);
    }

    async skipAction(ownerId: string, flowId: string): Promise<void> {
        const run = await this.deps.flowStore.getFlowRun(ownerId, flowId);
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

    async jumpToAction(ownerId: string, flowId: string, targetIndex: number): Promise<void> {
        const run = await this.deps.flowStore.getFlowRun(ownerId, flowId);
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
                if (run.actions[i].status === "running" || run.actions[i].status === "pending") {
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

        const owner = this.ownerFromRun(run);
        await this.launchPersistedActionWithRecovery(owner, flowId, run, targetIndex);
    }

    async pauseFlow(ownerId: string, flowId: string): Promise<void> {
        const run = await this.deps.flowStore.getFlowRun(ownerId, flowId);
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

    async resumeFlow(ownerId: string, flowId: string): Promise<void> {
        const run = await this.deps.flowStore.getFlowRun(ownerId, flowId);
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

        const owner = this.ownerFromRun(run);
        await this.launchPersistedActionWithRecovery(owner, flowId, run, run.currentActionIndex);
    }

    async stopFlow(ownerId: string, flowId: string): Promise<void> {
        const run = await this.deps.flowStore.getFlowRun(ownerId, flowId);
        if (!run) return;
        await this.failFlow(run);
    }

    async handleSessionExit(sessionId: string, exitCode: number): Promise<void> {
        const mapping = this.sessionFlowMap.get(sessionId);
        if (!mapping) return;

        const { ownerId, flowId, sessionType } = mapping;
        const run = await this.deps.flowStore.getFlowRun(ownerId, flowId);
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
        ownerId: string,
        flowId: string,
        actionEntryId: string,
        sessionId: string,
        artifact: Omit<FlowArtifact, "actionEntryId" | "createdAt">,
    ): Promise<void> {
        const run = await this.deps.flowStore.getFlowRun(ownerId, flowId);
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
        const artifacts = type ? run.artifacts.filter((a) => a.type === type) : run.artifacts;
        return artifacts.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    }

    async failFlowByIds(ownerId: string, flowId: string): Promise<void> {
        const run = await this.deps.flowStore.getFlowRun(ownerId, flowId);
        if (!run) return;
        await this.failFlow(run);
    }

    // --- Private helpers ---

    private getOwnerId(owner: FlowOwner): string {
        if (owner.taskId) return owner.taskId;
        if (owner.projectId) return owner.projectId;
        if (owner.master) return MASTER_OWNER_ID;
        throw new Error("FlowOwner must have taskId, projectId, or master");
    }

    private ownerFromRun(run: FlowRun): FlowOwner {
        if (run.taskId) return { taskId: run.taskId };
        if (run.projectId) return { projectId: run.projectId };
        if (run.master) return { master: true };
        throw new Error("FlowRun must have taskId, projectId, or master");
    }

    private async failFlow(run: FlowRun): Promise<void> {
        await this.endRun(run, {
            status: "failed",
            runningStepOutcome: "failed",
            skipPending: false,
        });
    }

    private async endRun(run: FlowRun, opts: EndRunOptions): Promise<void> {
        const currentAction = run.actions[run.currentActionIndex];
        if (currentAction?.sessionId) {
            // Drop the mapping before closing: handleSessionExit returns early
            // on a missing mapping, which makes the async exit inert.
            this.sessionFlowMap.delete(currentAction.sessionId);
            this.deps.closeSession(currentAction.sessionId);
            currentAction.sessionId = undefined;
        }
        if (currentAction?.status === "running") {
            currentAction.status = opts.runningStepOutcome;
            currentAction.completedAt = new Date().toISOString();
        }
        if (opts.skipPending) {
            const skippedAt = new Date().toISOString();
            for (const action of run.actions) {
                if (action.status === "pending") {
                    action.status = "skipped";
                    action.completedAt = skippedAt;
                }
            }
        }

        run.status = opts.status;
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

        const owner = this.ownerFromRun(run);
        await this.launchPersistedActionWithRecovery(owner, run.flowId, run, nextIndex);
    }

    private async launchAction(
        owner: FlowOwner,
        flow: FlowDefinition,
        run: FlowRun,
        actionIndex: number,
    ): Promise<void> {
        const actionEntry = flow.actions[actionIndex];
        if (!actionEntry) return;

        const resolved = await this.resolveAction(actionEntry);
        // Persisted flows may reference removed agent types; fail the action
        // with a clear message instead of letting the spawn path throw later.
        if (resolved.sessionType !== "shell" && !isAgentType(resolved.sessionType)) {
            throw new Error(
                `Action "${resolved.name}" uses unsupported agent type: ${String(resolved.sessionType)}`,
            );
        }
        const ownerDescription = await this.deps.getOwnerDescription(owner);
        const { prompt, systemPrompt } = this.buildActionPrompt(
            resolved.prompt,
            ownerDescription,
            resolved.sessionType,
            !!owner.projectId,
        );

        const ownerId = this.getOwnerId(owner);
        const sessionId = await this.deps.spawnSession({
            owner,
            sessionType: resolved.sessionType,
            prompt,
            systemPrompt,
            label: actionEntry.label ?? resolved.name,
            agentOptions: resolved.agentOptions,
            flowId: flow.id,
            actionEntryId: actionEntry.id,
        });

        this.sessionFlowMap.set(sessionId, {
            ownerId,
            owner,
            flowId: flow.id,
            actionEntryId: actionEntry.id,
            sessionType: resolved.sessionType,
        });
        run.actions[actionIndex].sessionId = sessionId;
        await this.deps.flowStore.saveFlowRun(run);
        this.broadcastUpdate(run);
    }

    private async launchActionWithRecovery(
        owner: FlowOwner,
        flow: FlowDefinition,
        run: FlowRun,
        actionIndex: number,
    ): Promise<void> {
        try {
            await this.launchAction(owner, flow, run, actionIndex);
        } catch (error) {
            await this.markActionLaunchFailed(run, actionIndex);
            throw error;
        }
    }

    private async launchPersistedActionWithRecovery(
        owner: FlowOwner,
        flowId: string,
        run: FlowRun,
        actionIndex: number,
    ): Promise<void> {
        try {
            const flow = await this.requireFlowDefinition(flowId);
            await this.launchAction(owner, flow, run, actionIndex);
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

    private async resolveFlowDefinition(flowId: string): Promise<FlowDefinition | null> {
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

    private async markActionLaunchFailed(run: FlowRun, actionIndex: number): Promise<void> {
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
        ownerDescription: string,
        sessionType: SessionType,
        isProjectScope: boolean,
    ): { prompt: string; systemPrompt?: string } {
        const descriptionHeader = isProjectScope ? "Project Description" : "Task Description";
        const systemPrompt = [
            `## ${descriptionHeader}\n\n${ownerDescription}`,
            `## Taskflow CLI`,
            `Use \`taskflow-cli task\` to read task info and logs.`,
            `Use \`taskflow-cli artifact list\` to see available artifacts from prior actions.`,
            `Use \`taskflow-cli artifact get <type>\` to retrieve a specific artifact.`,
            `Use \`taskflow-cli flow input\` to list all flow input values.`,
            `Use \`taskflow-cli flow input <id>\` to get a specific input value.`,
            `When you have completed this action, run \`taskflow-cli action complete\`.`,
        ].join("\n\n");
        return { prompt: actionPrompt, systemPrompt };
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
