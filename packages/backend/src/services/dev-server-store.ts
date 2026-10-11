import type { DevServer } from "@taskflow/shared";
import { readFile } from "fs/promises";
import { randomUUID } from "crypto";
import { KeyedQueue } from "./keyed-queue";
import { writeJsonAtomic } from "./write-file-atomic";

interface DevServerInput {
    pid: number;
    label: string;
    projectId: string;
    taskId?: string;
    sessionId?: string;
}

// One key for the whole file: reads and writes run in call order, so a list
// read after a write sees it. DevServerService relies on that to broadcast
// lists in mutation order.
const FILE_KEY = "file";

function isMissingFileError(error: unknown): boolean {
    return error instanceof Error && "code" in error && error.code === "ENOENT";
}

class DevServerStore {
    private readonly filePath: string;
    private readonly queue = new KeyedQueue();

    constructor(filePath: string) {
        this.filePath = filePath;
    }

    private async readAll(): Promise<DevServer[]> {
        let raw: string;
        try {
            raw = await readFile(this.filePath, "utf-8");
        } catch (error) {
            if (isMissingFileError(error)) return [];
            throw error;
        }
        try {
            const parsed: unknown = JSON.parse(raw);
            return Array.isArray(parsed) ? (parsed as DevServer[]) : [];
        } catch {
            // Records are disposable: a torn or hand-edited file must not block the feature.
            return [];
        }
    }

    list(): Promise<DevServer[]> {
        return this.queue.run(FILE_KEY, () => this.readAll());
    }

    get(id: string): Promise<DevServer | null> {
        return this.queue.run(
            FILE_KEY,
            async () => (await this.readAll()).find((server) => server.id === id) ?? null,
        );
    }

    add(input: DevServerInput): Promise<DevServer> {
        return this.queue.run(FILE_KEY, async () => {
            const servers = await this.readAll();
            const index = servers.findIndex((server) => server.pid === input.pid);
            const server: DevServer = {
                id: index === -1 ? randomUUID() : servers[index].id,
                pid: input.pid,
                label: input.label,
                registeredAt: new Date().toISOString(),
                projectId: input.projectId,
                ...(input.taskId ? { taskId: input.taskId } : {}),
                ...(input.sessionId ? { sessionId: input.sessionId } : {}),
            };
            if (index === -1) servers.push(server);
            else servers[index] = server;
            await writeJsonAtomic(this.filePath, servers);
            return server;
        });
    }

    remove(id: string): Promise<boolean> {
        return this.removeWhere((server) => server.id === id);
    }

    removeByPid(pid: number): Promise<boolean> {
        return this.removeWhere((server) => server.pid === pid);
    }

    /** Only while it is still that registration: a re-add of its pid keeps the id but not `registeredAt`. */
    removeIfUnchanged(target: DevServer): Promise<boolean> {
        return this.removeWhere(
            (server) => server.id === target.id && server.registeredAt === target.registeredAt,
        );
    }

    private removeWhere(match: (server: DevServer) => boolean): Promise<boolean> {
        return this.queue.run(FILE_KEY, async () => {
            const servers = await this.readAll();
            const kept = servers.filter((server) => !match(server));
            if (kept.length === servers.length) return false;
            await writeJsonAtomic(this.filePath, kept);
            return true;
        });
    }
}

export { DevServerStore };
export type { DevServerInput };
