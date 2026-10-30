import { afterEach, beforeEach, expect, it } from "bun:test";
import { mkdtemp, readdir, readFile, rm, stat } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import type { Schedule } from "@taskflow/shared";
import { ScheduleStore } from "../../src/services/schedule-store";

let dir: string;
let file: string;
let store: ScheduleStore;
const due = "2026-10-30T15:00:00.000+04:00";

beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "schedule-store-"));
    file = join(dir, "schedules.json");
    store = new ScheduleStore(file);
    await store.save({
        id: "s1",
        projectId: "p1",
        name: "Job",
        prompt: "Work",
        expression: "rate(1 hour)",
        expressionType: "rate",
        enabled: true,
        timeout: 30,
        nextRunAt: due,
        lastRunAt: null,
        lastError: null,
        runningSessionId: null,
        createdAt: due,
        updatedAt: due,
    });
});
afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
});

it("an unrelated definition edit preserves the stored nextRunAt exactly", async () => {
    const result = await store.updateDefinition("s1", (s) => ({
        ...s,
        name: "Renamed",
        nextRunAt: null,
    }));
    expect(result.timingChanged).toBe(false);
    expect(result.schedule.nextRunAt).toBe(due);
    expect((JSON.parse(await readFile(file, "utf-8")) as Schedule[])[0].nextRunAt).toBe(due);
});
it("repeating the same timing fields does not invalidate nextRunAt", async () => {
    const result = await store.updateDefinition("s1", (s) => ({
        ...s,
        expression: "rate(1 hour)",
        expressionType: "rate",
        enabled: true,
    }));
    expect(result.timingChanged).toBe(false);
    expect(result.schedule.nextRunAt).toBe(due);
});
it("changing expression, expressionType or enabled invalidates nextRunAt", async () => {
    for (const patch of [
        { expression: "rate(2 hours)" },
        { expressionType: "cron" as const },
        { enabled: false },
    ]) {
        await store.update("s1", (s) => ({ ...s, nextRunAt: due }));
        const result = await store.updateDefinition("s1", (s) => ({ ...s, ...patch }));
        expect(result.timingChanged).toBe(true);
        expect(result.schedule.nextRunAt).toBeNull();
        expect((await store.getById("s1"))?.nextRunAt).toBeNull();
    }
});
it("timing comparison runs against the current record inside the mutation queue", async () => {
    const first = store.update("s1", (s) => ({
        ...s,
        expression: "rate(2 hours)",
        nextRunAt: due,
    }));
    const second = store.updateDefinition("s1", (s) => ({ ...s, expression: "rate(2 hours)" }));
    await first;
    expect(await second).toMatchObject({ timingChanged: false, schedule: { nextRunAt: due } });
});
it("execution-state update can still advance nextRunAt", async () => {
    const future = "2026-11-01T00:00:00.000Z";
    await store.update("s1", (s) => ({ ...s, nextRunAt: future }));
    expect((await store.getById("s1"))?.nextRunAt).toBe(future);
});

it("a save replaces the file by rename, so an unlocked reader never sees it truncated", async () => {
    const before = (await stat(file)).ino;
    const original = await store.getById("s1");
    if (!original) throw new Error("seed schedule missing");
    await store.save({ ...original, name: "Renamed" });
    expect((await stat(file)).ino).not.toBe(before);
    expect((await readdir(dir)).sort()).toEqual(["schedules.json"]);
    expect((await store.getById("s1"))?.name).toBe("Renamed");
});

it("a read issued during a save waits for it, whatever the filesystem's write fallback", async () => {
    const original = await store.getById("s1");
    if (!original) throw new Error("seed schedule missing");
    const saving = store.save({ ...original, id: "s2" });
    const read = store.getAll();
    await saving;
    expect((await read).map((s) => s.id)).toEqual(["s1", "s2"]);
});

it("getById issued during a save waits for it", async () => {
    const original = await store.getById("s1");
    if (!original) throw new Error("seed schedule missing");
    const saving = store.save({ ...original, id: "s2" });
    const read = store.getById("s2");
    await saving;
    expect((await read)?.id).toBe("s2");
});
