import { afterEach, beforeEach, expect, it, spyOn } from "bun:test";
import { mkdtemp, readFile, rm } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import type { Schedule, WsEvent } from "@taskflow/shared";
import { ScheduleStore } from "../../src/services/schedule-store";
import { SchedulerService } from "../../src/services/scheduler-service";
import { expectRejects } from "../expect-rejects";

type Spawn = { sessionId: string; isShell: boolean };
type Timer = { callback: () => void; delay: number; cancelled: boolean };
const start = Date.parse("2026-10-30T10:00:00.000Z");
let dir: string;
let file: string;
let store: ScheduleStore;
let service: SchedulerService;
let now: number;
let online: boolean;
let timers: Timer[];
let events: WsEvent[];
let spawned: Schedule[];
let closed: string[];
let spawn: (schedule: Schedule) => Promise<Spawn>;
let onClose: (id: string) => void;
let exits: Promise<void>[];

function makeService(enabled = true): SchedulerService {
    return new SchedulerService({
        scheduleStore: store,
        enabled,
        now: () => now,
        isOnline: () => online,
        schedule: (callback, delay) => {
            const timer = { callback, delay, cancelled: false };
            timers.push(timer);
            return () => {
                timer.cancelled = true;
            };
        },
        spawnSession: async (schedule) => {
            spawned.push(schedule);
            return await spawn(schedule);
        },
        closeSession: (id) => {
            closed.push(id);
            onClose(id);
        },
        broadcast: (event) => {
            events.push(event);
        },
    });
}
async function save(patch: Partial<Schedule> = {}): Promise<void> {
    await store.save({
        id: "s1",
        projectId: "p1",
        name: "Job",
        prompt: "Work",
        expressionType: "rate",
        expression: "rate(1 minute)",
        enabled: true,
        timeout: 10,
        nextRunAt: new Date(start + 60_000).toISOString(),
        lastRunAt: null,
        lastError: null,
        runningSessionId: null,
        createdAt: new Date(start).toISOString(),
        updatedAt: new Date(start).toISOString(),
        ...patch,
    });
}
async function record(): Promise<Schedule> {
    const result = await store.getById("s1");
    if (!result) throw new Error("Missing fixture schedule");
    return result;
}
async function edit(patch: Partial<Schedule>): Promise<void> {
    const result = await store.updateDefinition("s1", (s) => ({ ...s, ...patch }));
    await service.onScheduleUpdated("s1", result.timingChanged);
}
function active(delay?: number): Timer[] {
    return timers.filter((t) => !t.cancelled && (delay === undefined || t.delay === delay));
}
function timer(delay: number): Timer {
    const found = active(delay)[0];
    if (!found) throw new Error(`No active timer with delay ${delay}`);
    return found;
}
function fire(t: Timer): void {
    t.cancelled = true;
    t.callback();
}
async function drain(): Promise<void> {
    // Timer callbacks intentionally return void. Let their filesystem work settle.
    for (let i = 0; i < 10; i++) {
        await Bun.sleep(2);
        await store.getAll();
    }
    await Promise.all(exits);
}
async function fireAndDrain(t: Timer): Promise<void> {
    fire(t);
    await drain();
}
function pendingSpawn() {
    const pending = Promise.withResolvers<Spawn>();
    spawn = () => pending.promise;
    return pending;
}
async function waitForSpawn(): Promise<void> {
    for (let i = 0; i < 100 && spawned.length === 0; i++) await Bun.sleep(2);
    expect(spawned).toHaveLength(1);
}

beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "scheduler-service-"));
    file = join(dir, "schedules.json");
    store = new ScheduleStore(file);
    now = start;
    online = true;
    timers = [];
    events = [];
    spawned = [];
    closed = [];
    exits = [];
    onClose = () => {};
    spawn = async () => ({ sessionId: `session${spawned.length}`, isShell: false });
    service = makeService();
    await save();
});
afterEach(async () => {
    service.shutdown();
    await Promise.all(exits);
    await rm(dir, { recursive: true, force: true });
});

it("two concurrent manual triggers reserve before the first await and spawn once", async () => {
    const results = await Promise.allSettled([service.triggerNow("s1"), service.triggerNow("s1")]);
    expect(spawned).toHaveLength(1);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect((await record()).runningSessionId).toBe("session1");
});
it("a due timer racing a manual trigger spawns once", async () => {
    await service.init();
    const due = timer(60_000);
    now += 60_000;
    fire(due);
    const manual = service.triggerNow("s1").catch((error: unknown) => error);
    await drain();
    await manual;
    expect(spawned).toHaveLength(1);
});
it("a wall-clock tick racing a due timer spawns once", async () => {
    await service.init();
    const tick = timer(30_000);
    const due = timer(60_000);
    now += 60_000;
    fire(tick);
    fire(due);
    await drain();
    expect(spawned).toHaveLength(1);
    expect((await record()).nextRunAt).toBe(new Date(now + 60_000).toISOString());
});
it("a duplicate manual trigger rejects with Schedule is already running", async () => {
    const pending = pendingSpawn();
    const first = service.triggerNow("s1");
    await waitForSpawn();
    const duplicate = service.triggerNow("s1");
    pending.resolve({ sessionId: "pending", isShell: false });
    await expectRejects(duplicate, /^Schedule is already running$/);
    await first;
    expect(spawned).toHaveLength(1);
});
it("startup runs an overdue cron once and stores the next occurrence after now", async () => {
    await save({
        expressionType: "cron",
        expression: "*/5 * * * *",
        nextRunAt: new Date(start - 86_400_000).toISOString(),
    });
    await service.init();
    await drain();
    expect(spawned).toHaveLength(1);
    expect((await record()).nextRunAt).toBe("2026-10-30T10:05:00.000Z");
    expect((await record()).lastRunAt).toBe(new Date(now).toISOString());
});
it("startup runs an overdue rate once and stores now plus interval", async () => {
    await save({ nextRunAt: new Date(start - 86_400_000).toISOString() });
    await service.init();
    await drain();
    expect(spawned).toHaveLength(1);
    expect((await record()).nextRunAt).toBe(new Date(now + 60_000).toISOString());
});
it("sleep across many occurrences catches up once on the next wall-clock tick", async () => {
    await service.init();
    now += 86_400_000;
    await fireAndDrain(timer(30_000));
    expect(spawned).toHaveLength(1);
    expect((await record()).nextRunAt).toBe(new Date(now + 60_000).toISOString());
});
it("an early timer rechecks the stored due time and does not spawn", async () => {
    await service.init();
    now += 1000;
    await fireAndDrain(timer(60_000));
    expect(spawned).toHaveLength(0);
    expect((await record()).nextRunAt).toBe(new Date(start + 60_000).toISOString());
    expect(active(59_000)).toHaveLength(1);
});
it("a future stored cron due time survives startup without a write", async () => {
    await save({ expressionType: "cron", expression: "*/5 * * * *" });
    const before = await readFile(file, "utf-8");
    await service.init();
    expect(await readFile(file, "utf-8")).toBe(before);
    expect(spawned).toHaveLength(0);
    expect(active(60_000)).toHaveLength(1);
});
it("a missing due time initializes once and remains stable on later checks", async () => {
    for (const missing of [null, "invalid"]) {
        await save({ nextRunAt: missing, lastRunAt: new Date(start - 60_000).toISOString() });
        await service.scheduleNext("s1");
        const before = await readFile(file, "utf-8");
        now += 1000;
        await service.scheduleNext("s1");
        expect(await readFile(file, "utf-8")).toBe(before);
        expect((await record()).nextRunAt).toBe(new Date(now - 1000 + 60_000).toISOString());
    }
});
it("offline deferral preserves nextRunAt and reconnect catches up once", async () => {
    online = false;
    await service.init();
    expect((await record()).lastError).toBeNull();
    const due = (await record()).nextRunAt;
    now += 120_000;
    await fireAndDrain(timer(30_000));
    expect((await record()).nextRunAt).toBe(due);
    expect((await record()).lastError).toBe("Skipped: offline");
    const before = await readFile(file, "utf-8");
    const count = events.length;
    now += 30_000;
    await fireAndDrain(timer(30_000));
    expect(await readFile(file, "utf-8")).toBe(before);
    expect(events).toHaveLength(count);
    online = true;
    await service.resumeDeferred();
    await drain();
    expect(spawned).toHaveLength(1);
    expect((await record()).nextRunAt).toBe(new Date(now + 60_000).toISOString());
});
it("spawn failure records its exact error, releases admission and arms a future retry", async () => {
    now += 10_000;
    spawn = async () => {
        throw new Error("spawn broke");
    };
    await service.triggerNow("s1");
    expect(await record()).toMatchObject({
        lastError: "Failed to spawn session: spawn broke",
        lastRunAt: new Date(now).toISOString(),
        nextRunAt: new Date(now + 60_000).toISOString(),
        runningSessionId: null,
    });
    expect(active(60_000)).toHaveLength(1);
    spawn = async () => ({ sessionId: "retry", isShell: false });
    now += 60_000;
    await fireAndDrain(timer(60_000));
    expect(spawned).toHaveLength(2);
    expect((await record()).runningSessionId).toBe("retry");
});
it("completion, shell exit, agent exit and timeout each release admission", async () => {
    for (const kind of ["complete", "shell", "agent", "timeout"] as const) {
        await save();
        spawn = async () => ({ sessionId: kind, isShell: kind === "shell" });
        await service.triggerNow("s1");
        if (kind === "complete") await service.handleComplete(kind);
        else if (kind === "timeout") {
            now += 600_000;
            await fireAndDrain(timer(600_000));
        } else await service.handleSessionExit(kind, kind === "shell" ? 0 : 2);
        // A long timeout can immediately catch up once. Finish that catch-up run.
        if ((await record()).runningSessionId) await service.handleComplete(kind);
        expect((await record()).runningSessionId).toBeNull();
        await service.triggerNow("s1");
        expect((await record()).runningSessionId).toBe(kind);
        await service.handleComplete(kind);
    }
});
it("closing a completed session does not finalize its run twice", async () => {
    await service.triggerNow("s1");
    events.length = 0;
    onClose = (id) => {
        exits.push(service.handleSessionExit(id, 9));
    };
    await service.handleComplete("session1");
    await drain();
    expect((await record()).lastError).toBeNull();
    expect(events).toHaveLength(1);
    expect(closed).toEqual(["session1"]);
});
it("an unrelated edit during a run keeps its admission and timeout", async () => {
    await service.triggerNow("s1");
    const due = (await record()).nextRunAt;
    const timeout = timer(600_000);
    await edit({ name: "Renamed", prompt: "New work", timeout: 99 });
    expect((await record()).nextRunAt).toBe(due);
    expect(timeout.cancelled).toBe(false);
    await expectRejects(service.triggerNow("s1"), /^Schedule is already running$/);
    // Fire early to isolate the originally installed timeout from catch-up.
    await fireAndDrain(timeout);
    expect((await record()).lastError).toBe("Timed out after 10 minutes");
    expect((await record()).runningSessionId).toBeNull();
});
it("a timing edit during pending spawn keeps the new definition and its due time", async () => {
    for (const disabled of [false, true]) {
        await save();
        const pending = pendingSpawn();
        const run = service.triggerNow("s1");
        await waitForSpawn();
        await edit({ expression: "rate(2 hours)", enabled: !disabled });
        const due = (await record()).nextRunAt;
        expect(due).toBe(disabled ? null : new Date(now + 7_200_000).toISOString());
        now += 5000;
        pending.resolve({ sessionId: `edited-${disabled}`, isShell: false });
        await run;
        expect(await record()).toMatchObject({
            expression: "rate(2 hours)",
            enabled: !disabled,
            nextRunAt: due,
        });
        await service.handleComplete(`edited-${disabled}`);
        spawned.length = 0;
    }
});
it("disabling a running schedule lets it finish without rescheduling", async () => {
    await service.triggerNow("s1");
    const timeout = timer(600_000);
    await edit({ enabled: false });
    expect((await record()).nextRunAt).toBeNull();
    expect(timeout.cancelled).toBe(false);
    expect(closed).toEqual([]);
    await service.handleComplete("session1");
    expect(active()).toHaveLength(0);
    expect((await record()).runningSessionId).toBeNull();
    await service.triggerNow("s1");
    expect(spawned).toHaveLength(1);
});
it("a due time passed during a run catches up once after completion", async () => {
    await service.init();
    await service.triggerNow("s1");
    now += 600_000;
    await fireAndDrain(timer(30_000));
    expect(spawned).toHaveLength(1);
    await service.handleComplete("session1");
    await drain();
    expect(spawned).toHaveLength(2);
    expect((await record()).nextRunAt).toBe(new Date(now + 60_000).toISOString());
});
it("deletion or shutdown during spawn closes the late session without rearming", async () => {
    for (const kind of ["delete", "shutdown"]) {
        service = makeService();
        await save();
        spawned.length = 0;
        const pending = pendingSpawn();
        const run = service.triggerNow("s1");
        await waitForSpawn();
        if (kind === "delete") {
            await store.delete("s1");
            await service.onScheduleDeleted("s1", null);
        } else service.shutdown();
        pending.resolve({ sessionId: kind, isShell: false });
        await run;
        expect(closed).toContain(kind);
        expect(active()).toHaveLength(0);
        if (kind === "delete") expect(await store.getById("s1")).toBeNull();
        else expect((await record()).runningSessionId).toBeNull();
    }
});
it("startup clears a stale runningSessionId and retains the restart error", async () => {
    await save({ runningSessionId: "stale" });
    const due = (await record()).nextRunAt;
    await service.init();
    expect(await record()).toMatchObject({
        runningSessionId: null,
        lastError: "Previous run did not complete (app restarted)",
        nextRunAt: due,
    });
});
it("a disabled scheduler installs no timers and rejects manual triggering", async () => {
    service = makeService(false);
    await service.init();
    await service.scheduleNext("s1");
    await service.onScheduleCreated("s1");
    await service.resumeDeferred();
    await expectRejects(
        service.triggerNow("s1"),
        /^Schedules are owned by the production Taskflow instance$/,
    );
    expect(timers).toEqual([]);
    expect(spawned).toEqual([]);
});
it("shutdown cancels the wall-clock tick and init never duplicates it", async () => {
    await Promise.all([service.init(), service.init()]);
    expect(active(30_000)).toHaveLength(1);
    await service.triggerNow("s1");
    await service.init();
    expect((await record()).runningSessionId).toBe("session1");
    expect(active(30_000)).toHaveLength(1);
    service.shutdown();
    expect(active()).toHaveLength(0);
});
it("failed store reads release pending admission", async () => {
    const read = spyOn(store, "getById").mockRejectedValueOnce(new Error("read failed"));
    await expectRejects(service.triggerNow("s1"), /^read failed$/);
    read.mockRestore();
    await service.triggerNow("s1");
    expect(spawned).toHaveLength(1);
});
it("persistence failure after spawn closes the session and releases admission", async () => {
    const update = spyOn(store, "update").mockRejectedValueOnce(new Error("write failed"));
    await expectRejects(service.triggerNow("s1"), /^write failed$/);
    update.mockRestore();
    expect(closed).toEqual(["session1"]);
    expect((await record()).runningSessionId).toBeNull();
    await service.triggerNow("s1");
    expect(spawned).toHaveLength(2);
});
it("long due delays are capped and rechecked", async () => {
    await save({ nextRunAt: new Date(now + 3_000_000_000).toISOString() });
    await service.init();
    now += 2_147_483_647;
    await fireAndDrain(timer(2_147_483_647));
    expect(spawned).toHaveLength(0);
    expect(active(3_000_000_000 - 2_147_483_647)).toHaveLength(1);
});

it("deletion during registration closes the run when the caller saw no runningSessionId", async () => {
    const persisted = Promise.withResolvers<undefined>();
    const release = Promise.withResolvers<undefined>();
    const update = store.update.bind(store);
    const registration = spyOn(store, "update").mockImplementationOnce(async (id, updater) => {
        const result = await update(id, updater);
        persisted.resolve(undefined);
        await release.promise;
        return result;
    });
    const run = service.triggerNow("s1");
    await persisted.promise;
    await store.delete("s1");
    await service.onScheduleDeleted("s1", null);
    release.resolve(undefined);
    await run;
    registration.mockRestore();
    expect(closed).toEqual(["session1"]);
    expect(active()).toHaveLength(0);
    expect(await store.getById("s1")).toBeNull();
});
it("a pending overdue spawn holds neither init nor other overdue schedules", async () => {
    const overdue = new Date(start - 60_000).toISOString();
    await save({ nextRunAt: overdue });
    await store.save({ ...(await record()), id: "s2", name: "Other" });
    const pending = pendingSpawn();
    await service.init();
    for (let i = 0; i < 100 && spawned.length < 2; i++) await Bun.sleep(2);
    expect(spawned.map((s) => s.id).sort()).toEqual(["s1", "s2"]);
    pending.resolve({ sessionId: "late", isShell: false });
    await drain();
});
it("a scheduling failure is recorded once across ticks", async () => {
    await save({ expression: "rate(soon)", nextRunAt: null });
    await service.init();
    expect((await record()).lastError).toBe(
        "Failed to schedule: Invalid rate expression: rate(soon)",
    );
    const before = await readFile(file, "utf-8");
    now += 30_000;
    await fireAndDrain(timer(30_000));
    expect(await readFile(file, "utf-8")).toBe(before);
});
