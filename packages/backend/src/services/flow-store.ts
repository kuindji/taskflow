import { readFile, writeFile, readdir, unlink, mkdir } from "fs/promises";
import type { Dirent } from "fs";
import { join } from "path";
import type { ActionDefinition, FlowDefinition, FlowRun } from "@taskflow/shared";
import { getFlowRunOwnerId } from "@taskflow/shared";
import { acquireFileMutationLock } from "./file-mutation-lock";

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
        private instanceId = "main",
    ) {}

    private get instanceFlowRunsDir(): string {
        return join(this.flowRunsDir, this.instanceId);
    }

    async init(): Promise<void> {
        await mkdir(this.flowsDir, { recursive: true });
        await mkdir(this.flowRunsDir, { recursive: true });
        await mkdir(this.instanceFlowRunsDir, { recursive: true });
    }

    // --- Action Definitions ---

    private get actionsFile(): string {
        return join(this.flowsDir, "actions.json");
    }

    async getActions(): Promise<ActionDefinition[]> {
        return (await this.readJsonFile<ActionDefinition[]>(this.actionsFile)) ?? [];
    }

    async saveAction(action: ActionDefinition): Promise<void> {
        await this.withMutation("definitions", async () => {
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
        return join(this.instanceFlowRunsDir, `${ownerId}${FLOW_RUN_SEPARATOR}${flowId}.json`);
    }

    private legacyFlowRunPath(ownerId: string, flowId: string): string {
        return join(this.flowRunsDir, `${ownerId}${FLOW_RUN_SEPARATOR}${flowId}.json`);
    }

    async getFlowRun(ownerId: string, flowId: string): Promise<FlowRun | null> {
        const current = await this.readJsonFile<FlowRun>(this.flowRunPath(ownerId, flowId));
        if (current || this.instanceId !== "main") return current;
        return this.readJsonFile<FlowRun>(this.legacyFlowRunPath(ownerId, flowId));
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
            if (this.instanceId === "main") {
                try {
                    await unlink(this.legacyFlowRunPath(ownerId, flowId));
                } catch (error) {
                    if (!isMissingFileError(error)) throw error;
                }
            }
        });
    }

    private async getOwnRunFiles(): Promise<string[]> {
        const files = (await readdir(this.instanceFlowRunsDir)).map((file) =>
            join(this.instanceFlowRunsDir, file),
        );
        if (this.instanceId !== "main") return files;
        const legacy = (await readdir(this.flowRunsDir, { withFileTypes: true }))
            .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
            .map((entry) => join(this.flowRunsDir, entry.name));
        return [...files, ...legacy];
    }

    private async getOwnRuns(): Promise<FlowRun[]> {
        const byKey = new Map<string, FlowRun>();
        for (const file of await this.getOwnRunFiles()) {
            if (!file.endsWith(".json")) continue;
            const run = await this.readJsonFile<FlowRun>(file);
            if (!run) continue;
            const key = `${getFlowRunOwnerId(run)}${FLOW_RUN_SEPARATOR}${run.flowId}`;
            if (!byKey.has(key)) byKey.set(key, run);
        }
        return [...byKey.values()];
    }

    async getFlowRunsForOwner(ownerId: string): Promise<FlowRun[]> {
        return (await this.getOwnRuns()).filter((run) => getFlowRunOwnerId(run) === ownerId);
    }

    async getAllActiveRuns(): Promise<FlowRun[]> {
        return (await this.getOwnRuns()).filter(
            (run) => run.status === "running" || run.status === "paused",
        );
    }

    private async hasActiveRunsForFlow(flowId: string): Promise<boolean> {
        let entries: Dirent[];
        try {
            entries = await readdir(this.flowRunsDir, { withFileTypes: true });
        } catch (error) {
            if (isMissingFileError(error)) {
                return false;
            }
            throw error;
        }

        const files: string[] = [];
        for (const entry of entries) {
            if (entry.isFile() && entry.name.endsWith(".json")) {
                files.push(join(this.flowRunsDir, entry.name));
            } else if (entry.isDirectory()) {
                const nested = await readdir(join(this.flowRunsDir, entry.name));
                files.push(
                    ...nested
                        .filter((file) => file.endsWith(".json"))
                        .map((file) => join(this.flowRunsDir, entry.name, file)),
                );
            }
        }

        for (const file of files) {
            const run = await this.readJsonFile<FlowRun>(file);
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
            const safeKey = key.replace(/[^a-zA-Z0-9_-]/g, "_");
            const lockTarget = join(this.flowRunsDir, `.mutation-${safeKey}`);
            const releaseFileLock = await acquireFileMutationLock(lockTarget);
            try {
                return await mutation();
            } finally {
                await releaseFileLock();
            }
        } finally {
            release();
            if (this.flowMutations.get(key) === queued) {
                this.flowMutations.delete(key);
            }
        }
    }
}

export { FlowStore };
