import { readFile, writeFile, readdir, unlink, mkdir } from "fs/promises";
import { join } from "path";
import type { ActionDefinition, FlowDefinition, FlowRun } from "@taskflow/shared";
import { getFlowRunOwnerId } from "@taskflow/shared";

const FLOW_RUN_SEPARATOR = "--";

function isMissingFileError(error: unknown): error is NodeJS.ErrnoException {
    return error instanceof Error && "code" in error && error.code === "ENOENT";
}

function assertValidFlowDefinition(flow: FlowDefinition): void {
    if (flow.actions.length === 0) {
        throw new Error(`Flow "${flow.id}" must define at least one action`);
    }

    if (flow.loop !== undefined && typeof flow.loop !== "boolean") {
        throw new Error(`Flow "${flow.id}" has a non-boolean loop value`);
    }

    for (const entry of flow.actions) {
        const hasActionId = entry.actionId !== undefined;
        const hasInline = entry.inline !== undefined;
        if (hasActionId === hasInline) {
            throw new Error(
                `Flow action "${entry.id}" must define exactly one of actionId or inline`,
            );
        }

        if (
            hasActionId &&
            (typeof entry.actionId !== "string" || entry.actionId.trim().length === 0)
        ) {
            throw new Error(`Flow action "${entry.id}" must use a non-empty actionId`);
        }

        if (hasInline) {
            const inline = entry.inline;
            if (
                inline === null ||
                typeof inline !== "object" ||
                typeof inline.name !== "string" ||
                typeof inline.prompt !== "string" ||
                typeof inline.sessionType !== "string"
            ) {
                throw new Error(`Flow action "${entry.id}" must use a valid inline action`);
            }
        }
    }

    if (flow.inputs) {
        const inputIds = new Set<string>();
        for (const input of flow.inputs) {
            if (typeof input.id !== "string" || input.id.trim().length === 0) {
                throw new Error(`Flow "${flow.id}" has an input with an empty id`);
            }
            if (!/^[a-zA-Z0-9_-]+$/.test(input.id)) {
                throw new Error(
                    `Flow input "${input.id}" has invalid id format (use only letters, numbers, hyphens, underscores)`,
                );
            }
            if (inputIds.has(input.id)) {
                throw new Error(`Flow "${flow.id}" has duplicate input id: "${input.id}"`);
            }
            inputIds.add(input.id);
            if (typeof input.label !== "string" || input.label.trim().length === 0) {
                throw new Error(`Flow input "${input.id}" must have a non-empty label`);
            }
            if (input.type !== "text" && input.type !== "filepath") {
                throw new Error(
                    `Flow input "${input.id}" has invalid type: "${String(input.type)}"`,
                );
            }
        }
    }
}

class FlowStore {
    private flowMutations = new Map<string, Promise<void>>();

    constructor(
        private flowsDir: string,
        private flowRunsDir: string,
    ) {}

    async init(): Promise<void> {
        await mkdir(this.flowsDir, { recursive: true });
        await mkdir(this.flowRunsDir, { recursive: true });
    }

    // --- Action Definitions ---

    private get actionsFile(): string {
        return join(this.flowsDir, "actions.json");
    }

    async getActions(): Promise<ActionDefinition[]> {
        return (await this.readJsonFile<ActionDefinition[]>(this.actionsFile)) ?? [];
    }

    async saveAction(action: ActionDefinition): Promise<void> {
        await this.withMutation("actions", async () => {
            const actions = await this.getActions();
            const index = actions.findIndex((s) => s.id === action.id);
            if (index >= 0) {
                actions[index] = action;
            } else {
                actions.push(action);
            }
            await writeFile(this.actionsFile, JSON.stringify(actions, null, 2));
        });
    }

    async deleteAction(id: string): Promise<void> {
        await this.withMutation("definitions", async () => {
            const referencingFlows = await this.getFlowsReferencingAction(id);
            if (referencingFlows.length > 0) {
                throw new Error(
                    `Cannot delete action "${id}" because it is used by: ${referencingFlows.map((flow) => flow.name).join(", ")}`,
                );
            }

            const actions = await this.getActions();
            const filtered = actions.filter((s) => s.id !== id);
            await writeFile(this.actionsFile, JSON.stringify(filtered, null, 2));
        });
    }

    // --- Flow Definitions ---

    private get definitionsFile(): string {
        return join(this.flowsDir, "definitions.json");
    }

    async getFlows(): Promise<FlowDefinition[]> {
        const flows = (await this.readJsonFile<FlowDefinition[]>(this.definitionsFile)) ?? [];
        for (const flow of flows) {
            assertValidFlowDefinition(flow);
        }
        return flows;
    }

    async getFlowsReferencingAction(actionId: string): Promise<FlowDefinition[]> {
        const flows = await this.getFlows();
        return flows.filter((flow) => flow.actions.some((entry) => entry.actionId === actionId));
    }

    async saveFlow(flow: FlowDefinition): Promise<void> {
        assertValidFlowDefinition(flow);
        await this.withMutation("definitions", async () => {
            const flows = await this.getFlows();
            const index = flows.findIndex((f) => f.id === flow.id);
            if (index >= 0) {
                flows[index] = flow;
            } else {
                flows.push(flow);
            }
            await writeFile(this.definitionsFile, JSON.stringify(flows, null, 2));
        });
    }

    async deleteFlow(id: string): Promise<void> {
        await this.withMutation("definitions", async () => {
            if (await this.hasActiveRunsForFlow(id)) {
                throw new Error(`Cannot delete flow "${id}" while it has active runs`);
            }
            const flows = await this.getFlows();
            const filtered = flows.filter((f) => f.id !== id);
            await writeFile(this.definitionsFile, JSON.stringify(filtered, null, 2));
        });
    }

    // --- Flow Runs ---

    private flowRunPath(ownerId: string, flowId: string): string {
        return join(this.flowRunsDir, `${ownerId}${FLOW_RUN_SEPARATOR}${flowId}.json`);
    }

    async getFlowRun(ownerId: string, flowId: string): Promise<FlowRun | null> {
        return await this.readJsonFile<FlowRun>(this.flowRunPath(ownerId, flowId));
    }

    async saveFlowRun(run: FlowRun): Promise<void> {
        const ownerId = getFlowRunOwnerId(run);
        const key = `${ownerId}${FLOW_RUN_SEPARATOR}${run.flowId}`;
        await this.withMutation(key, async () => {
            await writeFile(this.flowRunPath(ownerId, run.flowId), JSON.stringify(run, null, 2));
        });
    }

    async deleteFlowRun(ownerId: string, flowId: string): Promise<void> {
        const key = `${ownerId}${FLOW_RUN_SEPARATOR}${flowId}`;
        await this.withMutation(key, async () => {
            try {
                await unlink(this.flowRunPath(ownerId, flowId));
            } catch (error) {
                if (!isMissingFileError(error)) {
                    throw error;
                }
            }
        });
    }

    async getFlowRunsForOwner(ownerId: string): Promise<FlowRun[]> {
        const runs: FlowRun[] = [];
        let files: string[];
        try {
            files = await readdir(this.flowRunsDir);
        } catch (error) {
            if (isMissingFileError(error)) {
                return [];
            }
            throw error;
        }

        const prefix = `${ownerId}${FLOW_RUN_SEPARATOR}`;
        for (const file of files) {
            if (file.startsWith(prefix) && file.endsWith(".json")) {
                const run = await this.readJsonFile<FlowRun>(join(this.flowRunsDir, file));
                if (run) {
                    runs.push(run);
                }
            }
        }
        return runs;
    }

    async getAllActiveRuns(): Promise<FlowRun[]> {
        const runs: FlowRun[] = [];
        let files: string[];
        try {
            files = await readdir(this.flowRunsDir);
        } catch (error) {
            if (isMissingFileError(error)) {
                return [];
            }
            throw error;
        }

        for (const file of files) {
            if (!file.endsWith(".json")) continue;
            const run = await this.readJsonFile<FlowRun>(join(this.flowRunsDir, file));
            if (run && (run.status === "running" || run.status === "paused")) {
                runs.push(run);
            }
        }
        return runs;
    }

    private async hasActiveRunsForFlow(flowId: string): Promise<boolean> {
        let files: string[];
        try {
            files = await readdir(this.flowRunsDir);
        } catch (error) {
            if (isMissingFileError(error)) {
                return false;
            }
            throw error;
        }

        for (const file of files) {
            if (!file.endsWith(".json")) {
                continue;
            }
            const run = await this.readJsonFile<FlowRun>(join(this.flowRunsDir, file));
            if (!run || run.flowId !== flowId) {
                continue;
            }
            if (run.status === "running" || run.status === "paused") {
                return true;
            }
        }

        return false;
    }

    private async readJsonFile<T>(filePath: string): Promise<T | null> {
        let data: string;
        try {
            data = await readFile(filePath, "utf-8");
        } catch (error) {
            if (isMissingFileError(error)) {
                return null;
            }
            throw error;
        }

        return JSON.parse(data) as T;
    }

    // --- Mutation serialization ---

    private async withMutation<T>(key: string, mutation: () => Promise<T>): Promise<T> {
        const previous = this.flowMutations.get(key) ?? Promise.resolve();
        let release!: () => void;
        const gate = new Promise<void>((resolve) => {
            release = resolve;
        });
        const queued = previous.catch(() => undefined).then(() => gate);
        this.flowMutations.set(key, queued);
        await previous.catch(() => undefined);
        try {
            return await mutation();
        } finally {
            release();
            if (this.flowMutations.get(key) === queued) {
                this.flowMutations.delete(key);
            }
        }
    }
}

export { FlowStore };
