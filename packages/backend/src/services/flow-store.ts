import { readFile, writeFile, readdir, unlink, mkdir } from "fs/promises";
import { join } from "path";
import type { StepDefinition, FlowDefinition, FlowRun } from "@taskflow/shared";

const FLOW_RUN_SEPARATOR = "--";

function isMissingFileError(error: unknown): error is NodeJS.ErrnoException {
    return error instanceof Error && "code" in error && error.code === "ENOENT";
}

function assertValidFlowDefinition(flow: FlowDefinition): void {
    if (flow.steps.length === 0) {
        throw new Error(`Flow "${flow.id}" must define at least one step`);
    }

    for (const entry of flow.steps) {
        const hasStepId = entry.stepId !== undefined;
        const hasInline = entry.inline !== undefined;
        if (hasStepId === hasInline) {
            throw new Error(
                `Flow step "${entry.id}" must define exactly one of stepId or inline`,
            );
        }

        if (hasStepId && (typeof entry.stepId !== "string" || entry.stepId.trim().length === 0)) {
            throw new Error(`Flow step "${entry.id}" must use a non-empty stepId`);
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
                throw new Error(`Flow step "${entry.id}" must use a valid inline step`);
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

    // --- Step Definitions ---

    private get stepsFile(): string {
        return join(this.flowsDir, "steps.json");
    }

    async getSteps(): Promise<StepDefinition[]> {
        return (await this.readJsonFile<StepDefinition[]>(this.stepsFile)) ?? [];
    }

    async saveStep(step: StepDefinition): Promise<void> {
        await this.withMutation("steps", async () => {
            const steps = await this.getSteps();
            const index = steps.findIndex((s) => s.id === step.id);
            if (index >= 0) {
                steps[index] = step;
            } else {
                steps.push(step);
            }
            await writeFile(this.stepsFile, JSON.stringify(steps, null, 2));
        });
    }

    async deleteStep(id: string): Promise<void> {
        await this.withMutation("definitions", async () => {
            const referencingFlows = await this.getFlowsReferencingStep(id);
            if (referencingFlows.length > 0) {
                throw new Error(
                    `Cannot delete step "${id}" because it is used by: ${referencingFlows.map((flow) => flow.name).join(", ")}`,
                );
            }

            await this.withMutation("steps", async () => {
                const steps = await this.getSteps();
                const filtered = steps.filter((s) => s.id !== id);
                await writeFile(this.stepsFile, JSON.stringify(filtered, null, 2));
            });
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

    async getFlowsReferencingStep(stepId: string): Promise<FlowDefinition[]> {
        const flows = await this.getFlows();
        return flows.filter((flow) => flow.steps.some((entry) => entry.stepId === stepId));
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
            const flows = await this.getFlows();
            const filtered = flows.filter((f) => f.id !== id);
            await writeFile(this.definitionsFile, JSON.stringify(filtered, null, 2));
        });
    }

    // --- Flow Runs ---

    private flowRunPath(taskId: string, flowId: string): string {
        return join(this.flowRunsDir, `${taskId}${FLOW_RUN_SEPARATOR}${flowId}.json`);
    }

    async getFlowRun(taskId: string, flowId: string): Promise<FlowRun | null> {
        return await this.readJsonFile<FlowRun>(this.flowRunPath(taskId, flowId));
    }

    async saveFlowRun(run: FlowRun): Promise<void> {
        const key = `${run.taskId}${FLOW_RUN_SEPARATOR}${run.flowId}`;
        await this.withMutation(key, async () => {
            await writeFile(
                this.flowRunPath(run.taskId, run.flowId),
                JSON.stringify(run, null, 2),
            );
        });
    }

    async deleteFlowRun(taskId: string, flowId: string): Promise<void> {
        const key = `${taskId}${FLOW_RUN_SEPARATOR}${flowId}`;
        await this.withMutation(key, async () => {
            try {
                await unlink(this.flowRunPath(taskId, flowId));
            } catch (error) {
                if (!isMissingFileError(error)) {
                    throw error;
                }
            }
        });
    }

    async getFlowRunsForTask(taskId: string): Promise<FlowRun[]> {
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

        const prefix = `${taskId}${FLOW_RUN_SEPARATOR}`;
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
