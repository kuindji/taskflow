import { readFile, writeFile, readdir, unlink, mkdir } from "fs/promises";
import { join } from "path";
import type { StepDefinition, FlowDefinition, FlowRun } from "@taskflow/shared";

const FLOW_RUN_SEPARATOR = "--";

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
        try {
            const data = await readFile(this.stepsFile, "utf-8");
            return JSON.parse(data);
        } catch {
            return [];
        }
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
        await this.withMutation("steps", async () => {
            const steps = await this.getSteps();
            const filtered = steps.filter((s) => s.id !== id);
            await writeFile(this.stepsFile, JSON.stringify(filtered, null, 2));
        });
    }

    // --- Flow Definitions ---

    private get definitionsFile(): string {
        return join(this.flowsDir, "definitions.json");
    }

    async getFlows(): Promise<FlowDefinition[]> {
        try {
            const data = await readFile(this.definitionsFile, "utf-8");
            return JSON.parse(data);
        } catch {
            return [];
        }
    }

    async getFlowsReferencingStep(stepId: string): Promise<FlowDefinition[]> {
        const flows = await this.getFlows();
        return flows.filter((flow) => flow.steps.some((entry) => entry.stepId === stepId));
    }

    async saveFlow(flow: FlowDefinition): Promise<void> {
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
        try {
            const data = await readFile(this.flowRunPath(taskId, flowId), "utf-8");
            return JSON.parse(data);
        } catch {
            return null;
        }
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
            } catch {
                // File doesn't exist, that's fine
            }
        });
    }

    async getFlowRunsForTask(taskId: string): Promise<FlowRun[]> {
        const runs: FlowRun[] = [];
        try {
            const files = await readdir(this.flowRunsDir);
            const prefix = `${taskId}${FLOW_RUN_SEPARATOR}`;
            for (const file of files) {
                if (file.startsWith(prefix) && file.endsWith(".json")) {
                    const data = await readFile(join(this.flowRunsDir, file), "utf-8");
                    runs.push(JSON.parse(data));
                }
            }
        } catch {
            // Directory empty or doesn't exist
        }
        return runs;
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
