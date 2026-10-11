import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { DevServerStore } from "../../src/services/dev-server-store";

describe("DevServerStore", () => {
    let dir: string;
    let file: string;
    let store: DevServerStore;

    beforeEach(async () => {
        dir = await mkdtemp(join(tmpdir(), "dev-server-store-"));
        file = join(dir, "dev-servers-main.json");
        store = new DevServerStore(file);
    });

    afterEach(async () => {
        await rm(dir, { recursive: true, force: true });
    });

    it("reads a missing file as empty", async () => {
        expect(await store.list()).toEqual([]);
    });

    it("reads an unparsable file as empty", async () => {
        await writeFile(file, "{not json");
        expect(await store.list()).toEqual([]);
    });

    it("adds a record with an id and registeredAt, and persists it", async () => {
        const before = Date.now();
        const added = await store.add({
            pid: 4242,
            label: "Vite :5173",
            projectId: "p1",
            taskId: "t1",
            sessionId: "s1",
        });

        expect(added.id).toMatch(/^[0-9a-f-]{36}$/);
        expect(added).toMatchObject({
            pid: 4242,
            label: "Vite :5173",
            projectId: "p1",
            taskId: "t1",
            sessionId: "s1",
        });
        expect(Date.parse(added.registeredAt)).toBeGreaterThanOrEqual(before);
        expect(JSON.parse(await readFile(file, "utf-8")) as unknown).toEqual([added]);
        expect(await new DevServerStore(file).list()).toEqual([added]);
    });

    it("leaves out taskId and sessionId when they are not given", async () => {
        const added = await store.add({ pid: 7, label: "API :3000", projectId: "p1" });
        expect(added).not.toHaveProperty("taskId");
        expect(added).not.toHaveProperty("sessionId");
    });

    it("re-adding a pid replaces label, owner and registeredAt in place and keeps the id", async () => {
        const first = await store.add({
            pid: 10,
            label: "old",
            projectId: "p1",
            taskId: "t1",
            sessionId: "s1",
        });
        const other = await store.add({ pid: 11, label: "other", projectId: "p1" });
        await Bun.sleep(5);

        const second = await store.add({ pid: 10, label: "new", projectId: "p2" });

        expect(second.id).toBe(first.id);
        expect(second.label).toBe("new");
        expect(second.projectId).toBe("p2");
        expect(second).not.toHaveProperty("taskId");
        expect(second).not.toHaveProperty("sessionId");
        expect(Date.parse(second.registeredAt)).toBeGreaterThan(Date.parse(first.registeredAt));
        expect(await store.list()).toEqual([second, other]);
    });

    it("gets, removes by id and removes by pid", async () => {
        const a = await store.add({ pid: 1001, label: "a", projectId: "p" });
        await store.add({ pid: 1002, label: "b", projectId: "p" });

        expect(await store.get(a.id)).toEqual(a);
        expect(await store.get("missing")).toBeNull();
        expect(await store.remove(a.id)).toBe(true);
        expect(await store.remove(a.id)).toBe(false);
        expect(await store.removeByPid(1002)).toBe(true);
        expect(await store.removeByPid(1002)).toBe(false);
        expect(await store.list()).toEqual([]);
    });

    it("removes a record only while it is the same registration", async () => {
        const first = await store.add({ pid: 1001, label: "a", projectId: "p" });
        await Bun.sleep(5);
        const second = await store.add({ pid: 1001, label: "a again", projectId: "p" });

        expect(await store.removeIfUnchanged(first)).toBe(false);
        expect(await store.list()).toEqual([second]);
        expect(await store.removeIfUnchanged(second)).toBe(true);
        expect(await store.list()).toEqual([]);
    });

    it("serializes concurrent adds", async () => {
        const pids = Array.from({ length: 10 }, (_, i) => 2000 + i);
        await Promise.all(pids.map((pid) => store.add({ pid, label: `s${pid}`, projectId: "p" })));
        expect((await store.list()).map((s) => s.pid).sort((x, y) => x - y)).toEqual(pids);
    });
});
