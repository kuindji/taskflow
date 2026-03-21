import { readFile, writeFile } from "fs/promises";
import type { Schedule } from "@taskflow/shared";

function isMissingFileError(error: unknown): error is NodeJS.ErrnoException {
    return error instanceof Error && "code" in error && error.code === "ENOENT";
}

class ScheduleStore {
    private mutations = new Map<string, Promise<void>>();

    constructor(private schedulesFile: string) {}

    async getAll(): Promise<Schedule[]> {
        return (await this.readJsonFile<Schedule[]>(this.schedulesFile)) ?? [];
    }

    async getById(id: string): Promise<Schedule | null> {
        const schedules = await this.getAll();
        return schedules.find((s) => s.id === id) ?? null;
    }

    async findBySessionId(sessionId: string): Promise<Schedule | null> {
        const schedules = await this.getAll();
        return schedules.find((s) => s.runningSessionId === sessionId) ?? null;
    }

    async save(schedule: Schedule): Promise<void> {
        await this.withMutation("schedules", async () => {
            const schedules = await this.getAll();
            const index = schedules.findIndex((s) => s.id === schedule.id);
            if (index >= 0) {
                schedules[index] = schedule;
            } else {
                schedules.push(schedule);
            }
            await writeFile(this.schedulesFile, JSON.stringify(schedules, null, 2));
        });
    }

    async delete(id: string): Promise<void> {
        await this.withMutation("schedules", async () => {
            const schedules = await this.getAll();
            const filtered = schedules.filter((s) => s.id !== id);
            await writeFile(this.schedulesFile, JSON.stringify(filtered, null, 2));
        });
    }

    async update(id: string, updater: (schedule: Schedule) => Schedule): Promise<Schedule> {
        return await this.withMutation("schedules", async () => {
            const schedules = await this.getAll();
            const index = schedules.findIndex((s) => s.id === id);
            if (index < 0) throw new Error(`Schedule not found: ${id}`);
            schedules[index] = updater(schedules[index]);
            await writeFile(this.schedulesFile, JSON.stringify(schedules, null, 2));
            return schedules[index];
        });
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

    private async withMutation<T>(key: string, mutation: () => Promise<T>): Promise<T> {
        const previous = this.mutations.get(key) ?? Promise.resolve();
        let release!: () => void;
        const gate = new Promise<void>((resolve) => {
            release = resolve;
        });
        const queued = previous.catch(() => undefined).then(() => gate);
        this.mutations.set(key, queued);
        await previous.catch(() => undefined);
        try {
            return await mutation();
        } finally {
            release();
            if (this.mutations.get(key) === queued) {
                this.mutations.delete(key);
            }
        }
    }
}

export { ScheduleStore };
