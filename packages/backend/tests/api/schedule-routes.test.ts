import { afterEach, beforeEach, expect, it } from "bun:test";
import { mkdtemp, rm } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import type { Schedule, WsEvent } from "@taskflow/shared";
import { ApiRouter } from "../../src/api/router";
import { registerScheduleRoutes } from "../../src/api/routes/schedule-routes";
import { FlowStore } from "../../src/services/flow-store";
import { ScheduleStore } from "../../src/services/schedule-store";
import { SchedulerService } from "../../src/services/scheduler-service";

let dir: string;
let store: ScheduleStore;
let service: SchedulerService;
let router: ApiRouter;
let events: WsEvent[];
const now = Date.parse("2026-10-30T10:00:00.000Z");
const due = "2026-10-30T10:17:00.000Z";

beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "schedule-routes-"));
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
    router = new ApiRouter();
    registerScheduleRoutes({
        apiRouter: router,
        flowStore,
        scheduleStore: store,
        schedulerService: service,
        generateScheduleName: async () => "Job",
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
async function patch(body: Record<string, unknown>): Promise<Response> {
    const response = await router.handle(
        new Request("http://localhost/api/schedules/s1", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
        }),
    );
    if (!response) throw new Error("Missing route");
    return response;
}
async function updated(body: Record<string, unknown>): Promise<Schedule> {
    const response = await patch(body);
    expect(response.status).toBe(200);
    const result = (await response.json()) as Schedule;
    expect(await store.getById("s1")).toEqual(result);
    expect(events.at(-1)?.payload).toEqual(result);
    return result;
}
it("HTTP PATCH preserves nextRunAt for prompt and timeout edits", async () => {
    expect((await updated({ prompt: "New work", timeout: 60 })).nextRunAt).toBe(due);
});
it("HTTP PATCH repeating enabled true preserves nextRunAt", async () => {
    expect((await updated({ enabled: true })).nextRunAt).toBe(due);
});
it("HTTP PATCH changing timing returns the newly stored due time", async () => {
    expect((await updated({ expression: "rate(2 hours)" })).nextRunAt).toBe(
        "2026-10-30T12:00:00.000Z",
    );
});
it("HTTP and WS type-only edits validate the merged expression", async () => {
    const before = await store.getById("s1");
    const response = await patch({ expressionType: "cron" });
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(await store.getById("s1")).toEqual(before);
    expect(events).toEqual([]);
});
