import { MSG, getFlowRunOwnerId } from "@taskflow/shared";
import type {
    ActionDefinition,
    FlowActionsListResponse,
    FlowDefinition,
    FlowDefinitionsListResponse,
    FlowRun,
    FlowRunsListResponse,
    FlowStartPayload,
} from "@taskflow/shared";
import type { NetLike } from "../net/client";
import type { SessionOwner } from "../sessions/owner";
import { flowOwnerId } from "./model";

function upsert<T extends { id: string }>(items: readonly T[], next: T): T[] {
    const index = items.findIndex((item) => item.id === next.id);
    if (index < 0) return [...items, next];
    const copy = [...items];
    copy[index] = next;
    return copy;
}

function runKey(run: FlowRun): string {
    return `${run.flowId}:${run.startedAt}`;
}

function retainedRun(runs: readonly FlowRun[], dismissed: ReadonlySet<string>): FlowRun | null {
    const available = runs.filter((run) => !dismissed.has(runKey(run)));
    return (
        available.find((run) => run.status === "running" || run.status === "paused") ??
        available.sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0] ??
        null
    );
}

class FlowStore {
    private flowList: FlowDefinition[] = [];
    private actionList: ActionDefinition[] = [];
    private readonly runByOwner = new Map<string, FlowRun>();
    private readonly dismissedByOwner = new Map<string, Set<string>>();
    private readonly listeners = new Set<() => void>();
    private readonly disposers: (() => void)[] = [];
    private definitionLoadToken = 0;
    private runLoadToken = 0;
    private readonly runEventRevisionByOwner = new Map<string, number>();
    private disposed = false;

    constructor(private readonly net: NetLike) {
        this.disposers.push(
            net.on(MSG.FLOW_RUN_UPDATED, (payload) => {
                if (!payload || typeof payload !== "object" || !("flowId" in payload)) return;
                this.applyRunUpdate(payload as FlowRun);
            }),
        );
    }

    get flows(): readonly FlowDefinition[] {
        return this.flowList;
    }

    get actions(): readonly ActionDefinition[] {
        return this.actionList;
    }

    runFor(owner: SessionOwner | string): FlowRun | null {
        const ownerId = typeof owner === "string" ? owner : flowOwnerId(owner);
        return this.runByOwner.get(ownerId) ?? null;
    }

    onChange(listener: () => void): () => void {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    private notify(): void {
        if (this.disposed) return;
        for (const listener of [...this.listeners]) listener();
    }

    async loadDefinitions(): Promise<void> {
        const token = ++this.definitionLoadToken;
        const [flowResponse, actionResponse] = await Promise.all([
            this.net.request<FlowDefinitionsListResponse>(MSG.FLOW_DEFINITIONS_LIST),
            this.net.request<FlowActionsListResponse>(MSG.FLOW_ACTIONS_LIST),
        ]);
        if (this.disposed || token !== this.definitionLoadToken) return;
        this.flowList = flowResponse.flows;
        this.actionList = actionResponse.actions;
        this.notify();
    }

    async loadRun(owner: SessionOwner): Promise<void> {
        const token = ++this.runLoadToken;
        const ownerId = flowOwnerId(owner);
        const eventRevision = this.runEventRevisionByOwner.get(ownerId) ?? 0;
        const response = await this.net.request<FlowRunsListResponse>(MSG.FLOW_RUNS_LIST, {
            ownerId,
        });
        if (
            this.disposed ||
            token !== this.runLoadToken ||
            eventRevision !== (this.runEventRevisionByOwner.get(ownerId) ?? 0)
        ) {
            return;
        }
        const dismissed = this.dismissedByOwner.get(ownerId) ?? new Set<string>();
        const run = retainedRun(response.runs, dismissed);
        if (run) this.runByOwner.set(ownerId, run);
        else this.runByOwner.delete(ownerId);
        this.notify();
    }

    async saveFlow(flow: FlowDefinition): Promise<void> {
        const saved = await this.net.request<FlowDefinition>(MSG.FLOW_DEFINITION_SAVE, flow);
        this.flowList = upsert(this.flowList, saved);
        this.notify();
    }

    async saveAction(action: ActionDefinition): Promise<void> {
        const saved = await this.net.request<ActionDefinition>(MSG.FLOW_ACTION_SAVE, action);
        this.actionList = upsert(this.actionList, saved);
        this.notify();
    }

    async deleteFlow(id: string): Promise<void> {
        await this.net.request(MSG.FLOW_DEFINITION_DELETE, { id });
        this.flowList = this.flowList.filter((flow) => flow.id !== id);
        this.notify();
    }

    async deleteAction(id: string): Promise<void> {
        await this.net.request(MSG.FLOW_ACTION_DELETE, { id });
        this.actionList = this.actionList.filter((action) => action.id !== id);
        this.notify();
    }

    async startFlow(payload: FlowStartPayload): Promise<FlowRun> {
        const run = await this.net.request<FlowRun>(MSG.FLOW_START, payload);
        const ownerId = getFlowRunOwnerId(run);
        this.dismissedByOwner.delete(ownerId);
        this.runByOwner.set(ownerId, run);
        this.notify();
        return run;
    }

    async pause(ownerId: string, flowId: string): Promise<void> {
        await this.net.request(MSG.FLOW_PAUSE, { ownerId, flowId });
    }

    async resume(ownerId: string, flowId: string): Promise<void> {
        await this.net.request(MSG.FLOW_RESUME, { ownerId, flowId });
    }

    async stop(ownerId: string, flowId: string): Promise<void> {
        await this.net.request(MSG.FLOW_STOP, { ownerId, flowId });
    }

    async skip(ownerId: string, flowId: string): Promise<void> {
        await this.net.request(MSG.FLOW_SKIP_ACTION, { ownerId, flowId });
    }

    async jump(ownerId: string, flowId: string, actionIndex: number): Promise<void> {
        await this.net.request(MSG.FLOW_JUMP_TO_ACTION, { ownerId, flowId, actionIndex });
    }

    dismissRun(owner: SessionOwner | string): void {
        const ownerId = typeof owner === "string" ? owner : flowOwnerId(owner);
        const run = this.runByOwner.get(ownerId);
        if (!run) return;
        const dismissed = this.dismissedByOwner.get(ownerId) ?? new Set<string>();
        dismissed.add(runKey(run));
        this.dismissedByOwner.set(ownerId, dismissed);
        this.runByOwner.delete(ownerId);
        this.notify();
    }

    private applyRunUpdate(run: FlowRun): void {
        const ownerId = getFlowRunOwnerId(run);
        const tracked = this.runByOwner.get(ownerId);
        if (run.status === "running" || run.status === "paused") {
            this.dismissedByOwner.delete(ownerId);
            this.runByOwner.set(ownerId, run);
        } else if (tracked?.flowId === run.flowId && tracked.startedAt === run.startedAt) {
            this.runByOwner.set(ownerId, run);
        } else {
            return;
        }
        this.runEventRevisionByOwner.set(
            ownerId,
            (this.runEventRevisionByOwner.get(ownerId) ?? 0) + 1,
        );
        this.notify();
    }

    dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        for (const dispose of this.disposers) dispose();
        this.disposers.length = 0;
        this.listeners.clear();
    }
}

export { FlowStore };
