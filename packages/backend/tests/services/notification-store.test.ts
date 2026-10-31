import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { NotificationStore } from "../../src/services/notification-store";
import { defaultFileOperations } from "../../src/services/write-file-atomic";
import type { FileOperations } from "../../src/services/write-file-atomic";

describe("NotificationStore", () => {
    let dir: string;
    let filePath: string;

    beforeEach(async () => {
        dir = await mkdtemp(join(tmpdir(), "taskflow-notifications-"));
        filePath = join(dir, "notifications.json");
    });

    afterEach(async () => {
        await rm(dir, { recursive: true, force: true });
    });

    test("list during a write returns the previous complete snapshot", async () => {
        let blockWrites = false;
        let writeStarted!: () => void;
        const started = new Promise<void>((resolve) => {
            writeStarted = resolve;
        });
        let releaseWrite!: () => void;
        const released = new Promise<void>((resolve) => {
            releaseWrite = resolve;
        });
        const operations: FileOperations = {
            ...defaultFileOperations,
            async writeFile(path, data) {
                await defaultFileOperations.writeFile(path, data);
                if (blockWrites) {
                    writeStarted();
                    await released;
                }
            },
        };
        const store = new NotificationStore(filePath, operations);
        const first = await store.create("p1", "s1", "first");

        blockWrites = true;
        const pending = store.create("p1", "s2", "second");
        await started;

        const during = await store.list();
        expect(during.map((n) => n.id)).toEqual([first.id]);

        releaseWrite();
        const second = await pending;
        const after = await store.list();
        expect(after.map((n) => n.id)).toEqual([first.id, second.id]);
    });
});
