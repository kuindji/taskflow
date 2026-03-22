import type { Notification } from "@taskflow/shared";
import { readFile, writeFile } from "fs/promises";
import { randomUUID } from "crypto";

function isMissingFileError(error: unknown): error is NodeJS.ErrnoException {
    return error instanceof Error && "code" in error && error.code === "ENOENT";
}

export class NotificationStore {
    private filePath: string;
    private mutation: Promise<void> = Promise.resolve();

    constructor(filePath: string) {
        this.filePath = filePath;
    }

    private async withMutation<T>(fn: () => Promise<T>): Promise<T> {
        const previous = this.mutation;
        let release!: () => void;
        const gate = new Promise<void>((resolve) => {
            release = resolve;
        });
        this.mutation = previous.catch(() => undefined).then(() => gate);
        await previous.catch(() => undefined);

        try {
            return await fn();
        } finally {
            release();
        }
    }

    private async readAll(): Promise<Notification[]> {
        try {
            const raw = await readFile(this.filePath, "utf-8");
            return JSON.parse(raw) as Notification[];
        } catch (error) {
            if (isMissingFileError(error)) return [];
            throw error;
        }
    }

    private async writeAll(notifications: Notification[]): Promise<void> {
        await writeFile(this.filePath, JSON.stringify(notifications, null, 2));
    }

    async list(): Promise<Notification[]> {
        return this.readAll();
    }

    async create(
        projectId: string,
        sessionId: string,
        message: string,
        taskId?: string,
    ): Promise<Notification> {
        return this.withMutation(async () => {
            const notifications = await this.readAll();
            const notification: Notification = {
                id: randomUUID(),
                projectId,
                sessionId,
                message,
                read: false,
                createdAt: new Date().toISOString(),
                ...(taskId ? { taskId } : {}),
            };
            notifications.push(notification);
            await this.writeAll(notifications);
            return notification;
        });
    }

    async markAsRead(id: string): Promise<Notification | null> {
        return this.withMutation(async () => {
            const notifications = await this.readAll();
            const notification = notifications.find((n) => n.id === id);
            if (!notification) return null;
            notification.read = true;
            await this.writeAll(notifications);
            return notification;
        });
    }

    async delete(id: string): Promise<boolean> {
        return this.withMutation(async () => {
            const notifications = await this.readAll();
            const index = notifications.findIndex((n) => n.id === id);
            if (index === -1) return false;
            notifications.splice(index, 1);
            await this.writeAll(notifications);
            return true;
        });
    }

    async deleteAll(): Promise<void> {
        return this.withMutation(async () => {
            await this.writeAll([]);
        });
    }
}
