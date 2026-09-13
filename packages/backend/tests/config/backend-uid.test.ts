import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { readOrCreateBackendUid } from "../../src/config";

describe("readOrCreateBackendUid", () => {
    test("mints a uid once and returns the same one afterwards", async () => {
        const dir = await mkdtemp(join(tmpdir(), "uid-"));
        try {
            const first = readOrCreateBackendUid(dir, "main");
            const second = readOrCreateBackendUid(dir, "main");
            expect(first).toBe(second);
            expect(first).toMatch(/^[0-9a-f]{32}$/);
            expect((await readFile(join(dir, "backend-uid-main"), "utf-8")).trim()).toBe(first);
        } finally {
            await rm(dir, { recursive: true, force: true });
        }
    });

    test("two base directories get different uids", async () => {
        const a = await mkdtemp(join(tmpdir(), "uid-a-"));
        const b = await mkdtemp(join(tmpdir(), "uid-b-"));
        try {
            expect(readOrCreateBackendUid(a, "main")).not.toBe(readOrCreateBackendUid(b, "main"));
        } finally {
            await rm(a, { recursive: true, force: true });
            await rm(b, { recursive: true, force: true });
        }
    });

    test("two instances in one base directory get different uids", async () => {
        // main and dev-* share BASE_DIR (and the data dir). One uid between them
        // would make adoptUid merge them into a single record.
        const dir = await mkdtemp(join(tmpdir(), "uid-"));
        try {
            expect(readOrCreateBackendUid(dir, "main")).not.toBe(
                readOrCreateBackendUid(dir, "dev-feature-x"),
            );
        } finally {
            await rm(dir, { recursive: true, force: true });
        }
    });
});
