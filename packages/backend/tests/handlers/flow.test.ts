import { afterEach, beforeEach, expect, it } from "bun:test";
import { mkdtemp, rm } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { MSG } from "@taskflow/shared";
import { TestRouter } from "../test-router";
import { expectRejects } from "../expect-rejects";
import { registerFlowHandlers } from "../../src/handlers/flow";
import { FlowStore } from "../../src/services/flow-store";
import { ScheduleStore } from "../../src/services/schedule-store";

const stamp = "2026-10-30T10:00:00.000Z";
let dir: string;
let flowStore: FlowStore;
let scheduleStore: ScheduleStore;
let router: TestRouter;

beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "flow-handlers-"));
    flowStore = new FlowStore(join(dir, "flows"), join(dir, "runs"));
    await flowStore.init();
    scheduleStore = new ScheduleStore(join(dir, "schedules.json"));
    router = new TestRouter();
    registerFlowHandlers({ router, flowStore, scheduleStore, flowRunner: {} as never });
    await flowStore.saveAction({
        id: "a1",
        name: "Nightly review",
        prompt: "Review",
        sessionType: "claude",
        createdAt: stamp,
        updatedAt: stamp,
    });
});
afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
});

it("WS action delete refuses an action a schedule runs", async () => {
    await scheduleStore.save({
        id: "s1",
        projectId: "p1",
        name: "Nightly",
        prompt: "",
        actionId: "a1",
        expression: "rate(1 day)",
        expressionType: "rate",
        enabled: true,
        timeout: 30,
        nextRunAt: null,
        lastRunAt: null,
        lastError: null,
        runningSessionId: null,
        createdAt: stamp,
        updatedAt: stamp,
    });
    await expectRejects(
        router.handle(MSG.FLOW_ACTION_DELETE, { id: "a1" }),
        /used by: schedule "Nightly"$/,
    );
    expect((await flowStore.getActions()).map((a) => a.id)).toEqual(["a1"]);

    await scheduleStore.delete("s1");
    await router.handle(MSG.FLOW_ACTION_DELETE, { id: "a1" });
    expect(await flowStore.getActions()).toEqual([]);
});
