import { afterEach, beforeEach, expect, it } from "bun:test";
import { mkdtemp, rm } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import {
    MSG,
    type DevServerListResponse,
    type DevServerStopResult,
    type WsEvent,
} from "@taskflow/shared";
import { TestRouter } from "../test-router";
import { expectRejects } from "../expect-rejects";
import { DevServerStore } from "../../src/services/dev-server-store";
import {
    createDevServerService,
    type DevServerService,
} from "../../src/services/dev-server-service";
import type { StopProcess } from "../../src/services/process-stopper";
import { registerDevServerHandlers } from "../../src/handlers/dev-server";

let tempDir: string;
let router: TestRouter;
let service: DevServerService;
let events: WsEvent[];
let outcome: Awaited<ReturnType<StopProcess>>;
let stopCalls: Array<{ pid: number; registeredAt: string }>;

beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "taskflow-dev-server-handlers-"));
    events = [];
    stopCalls = [];
    outcome = { status: "stopped" };
    service = createDevServerService({
        store: new DevServerStore(join(tempDir, "dev-servers.json")),
        broadcast: (event) => {
            events.push(event);
        },
        stopProcess: async (pid, registeredAt) => {
            stopCalls.push({ pid, registeredAt });
            return outcome;
        },
    });
    router = new TestRouter();
    registerDevServerHandlers({ router, devServerService: service });
});

afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
});

it("lists every dev server on the backend, whatever its owner", async () => {
    await service.add({ pid: 3001, label: "UI :5173", projectId: "p1", taskId: "t1" });
    await service.add({ pid: 3002, label: "Expo :8087", projectId: "p2" });

    const listed = (await router.handle(MSG.DEV_SERVER_LIST, {})) as DevServerListResponse;

    expect(listed.devServers.map((server) => server.pid).sort()).toEqual([3001, 3002]);
});

it("stops a dev server and drops it from the list", async () => {
    const created = await service.add({ pid: 3003, label: "UI :5173", projectId: "p1" });
    events.length = 0;

    const result = (await router.handle(MSG.DEV_SERVER_STOP, {
        id: created.id,
    })) as DevServerStopResult;

    expect(result).toEqual({ ok: true });
    expect(stopCalls).toEqual([{ pid: 3003, registeredAt: created.registeredAt }]);
    expect(await service.list()).toEqual([]);
    expect(events).toEqual([{ type: MSG.DEV_SERVER_LIST, payload: { devServers: [] } }]);
});

it("keeps the record and returns the error when the stop fails", async () => {
    const created = await service.add({ pid: 3004, label: "UI :5173", projectId: "p1" });
    outcome = { status: "failed", error: "Could not stop pid 3004: operation not permitted" };

    const result = (await router.handle(MSG.DEV_SERVER_STOP, {
        id: created.id,
    })) as DevServerStopResult;

    expect(result).toEqual({
        ok: false,
        error: "Could not stop pid 3004: operation not permitted",
    });
    expect(await service.list()).toEqual([created]);
});

it("rejects a stop without a string id", async () => {
    await expectRejects(router.handle(MSG.DEV_SERVER_STOP, {}), /Field 'id' is required/);
    await expectRejects(router.handle(MSG.DEV_SERVER_STOP, { id: 7 }), /Field 'id' is required/);
    await expectRejects(router.handle(MSG.DEV_SERVER_STOP, null), /Field 'id' is required/);
    expect(stopCalls).toEqual([]);
});
