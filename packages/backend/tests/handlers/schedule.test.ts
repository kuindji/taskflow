import { afterEach, beforeEach, expect, it } from "bun:test";
import { mkdtemp, rm } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { MSG, type Schedule, type WsEvent } from "@taskflow/shared";
import { TestRouter } from "../test-router";
import { expectRejects } from "../expect-rejects";
import { registerScheduleHandlers } from "../../src/handlers/schedule";
import { FlowStore } from "../../src/services/flow-store";
import { ScheduleStore } from "../../src/services/schedule-store";
import { SchedulerService } from "../../src/services/scheduler-service";

let dir: string;
let store: ScheduleStore;
let service: SchedulerService;
let router: TestRouter;
let events: WsEvent[];
const now = Date.parse("2026-10-30T10:00:00.000Z");
const due = "2026-10-30T10:17:00.000Z";
beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "schedule-handlers-"));
    store = new ScheduleStore(join(dir, "schedules.json"));
    events = [];
    service = new SchedulerService({
        scheduleStore: store,
        now: () => now,
        schedule: () => () => {},
        spawnSession: async () => {
            throw new Error("Unexpected spawn");
        },
        closeSession: () => {},
        broadcast: (event) => {
            events.push(event);
        },
        isOnline: () => true,
    });
    const flowStore = new FlowStore(join(dir, "flows"), join(dir, "runs"));
    await flowStore.init();
    router = new TestRouter();
    registerScheduleHandlers({
        router,
        flowStore,
        scheduleStore: store,
        schedulerService: service,
        generateName: async () => "Job",
    });
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
    await service.init();
    events.length = 0;
});
afterEach(async () => {
    service.shutdown();
    await rm(dir, { recursive: true, force: true });
});
async function update(patch: Record<string, unknown>): Promise<Schedule> {
    const result = (await router.handle(MSG.SCHEDULE_UPDATE, { id: "s1", ...patch })) as Schedule;
    expect(await store.getById("s1")).toEqual(result);
    expect(events.at(-1)?.payload).toEqual(result);
    return result;
}
it("WS schedule:update preserves nextRunAt for agent and action edits", async () => {
    expect(
        (await update({ agentType: "shell", agentOptions: {}, actionId: "action1" })).nextRunAt,
    ).toBe(due);
    const cleared = await update({ agentType: null, agentOptions: null, actionId: null });
    expect(cleared.nextRunAt).toBe(due);
    expect(cleared.agentType).toBeUndefined();
    expect(cleared.agentOptions).toBeUndefined();
    expect(cleared.actionId).toBeUndefined();
});
it("WS schedule:update changing timing returns the newly stored due time", async () => {
    expect((await update({ expression: "rate(2 hours)" })).nextRunAt).toBe(
        "2026-10-30T12:00:00.000Z",
    );
});
it("HTTP and WS type-only edits validate the merged expression", async () => {
    const before = await store.getById("s1");
    await expectRejects(router.handle(MSG.SCHEDULE_UPDATE, { id: "s1", expressionType: "cron" }));
    expect(await store.getById("s1")).toEqual(before);
    expect(events).toEqual([]);
});
