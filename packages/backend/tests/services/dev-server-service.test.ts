import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { MSG } from "@taskflow/shared";
import type { DevServerListResponse, WsEvent } from "@taskflow/shared";
import { DevServerStore } from "../../src/services/dev-server-store";
import { createDevServerService, DevServerInputError } from "../../src/services/dev-server-service";
import type { StopOutcome, StopProcess } from "../../src/services/process-stopper";
import { expectRejects } from "../expect-rejects";

describe("DevServerService", () => {
    let dir: string;
    let store: DevServerStore;
    let events: WsEvent[];
    let outcome: StopOutcome;
    let stopCalls: Array<{ pid: number; registeredAt: string }>;

    const stopProcess: StopProcess = (pid, registeredAt) => {
        stopCalls.push({ pid, registeredAt });
        return Promise.resolve(outcome);
    };

    function service() {
        return createDevServerService({
            store,
            broadcast: (event) => events.push(event),
            stopProcess,
        });
    }

    /** The pids in each broadcast list, in broadcast order. */
    function broadcastPids(): number[][] {
        return events.map((event) => {
            expect(event.type).toBe(MSG.DEV_SERVER_LIST);
            return (event.payload as DevServerListResponse).devServers.map((s) => s.pid);
        });
    }

    beforeEach(async () => {
        dir = await mkdtemp(join(tmpdir(), "dev-server-service-"));
        store = new DevServerStore(join(dir, "dev-servers.json"));
        events = [];
        outcome = { status: "stopped" };
        stopCalls = [];
    });

    afterEach(async () => {
        await rm(dir, { recursive: true, force: true });
    });

    it("rejects invalid input with the exact messages and stores nothing", async () => {
        const s = service();
        for (const pid of [0, -1, 1.5, Number.NaN]) {
            await expectRejects(
                s.add({ projectId: "p", pid, label: "Vite :5173" }),
                "Field 'pid' must be a positive integer",
            );
        }
        await expectRejects(
            s.add({ projectId: "p", pid: 5, label: "   " }),
            "Field 'label' is required and must be a non-empty string",
        );
        await expectRejects(
            s.add({ projectId: "p", pid: 5, label: "x".repeat(81) }),
            "Field 'label' must be at most 80 characters",
        );
        const error = await s.add({ projectId: "p", pid: 0, label: "x" }).catch((e: unknown) => e);
        expect(error).toBeInstanceOf(DevServerInputError);
        expect(await store.list()).toEqual([]);
        expect(events).toEqual([]);
    });

    it("stores a trimmed label, accepts 80 characters, and broadcasts after an add", async () => {
        const s = service();
        const added = await s.add({ projectId: "p", pid: 7, label: "  Vite :5173  " });
        expect(added.label).toBe("Vite :5173");
        await s.add({ projectId: "p", pid: 8, label: "y".repeat(80) });
        expect(broadcastPids()).toEqual([[7], [7, 8]]);
    });

    it("re-adding a pid keeps one record", async () => {
        const s = service();
        const first = await s.add({ projectId: "p", pid: 7, label: "a" });
        const second = await s.add({ projectId: "p", taskId: "t", pid: 7, label: "b" });
        expect(second.id).toBe(first.id);
        expect(await s.list()).toEqual([second]);
        expect(broadcastPids()).toEqual([[7], [7]]);
    });

    it("broadcasts concurrent adds in mutation order", async () => {
        const s = service();
        await Promise.all([
            s.add({ projectId: "p", pid: 1, label: "a" }),
            s.add({ projectId: "p", pid: 2, label: "b" }),
        ]);
        const pids = broadcastPids();
        expect(pids[pids.length - 1]).toEqual([1, 2]);
        expect(pids[0].length).toBeLessThanOrEqual(pids[1].length);
    });

    it("broadcasts after a remove that hit and not after one that missed", async () => {
        const s = service();
        const a = await s.add({ projectId: "p", pid: 7, label: "a" });
        await s.add({ projectId: "p", pid: 8, label: "b" });
        events = [];

        expect(await s.remove("missing")).toBe(false);
        expect(await s.removeByPid(999)).toBe(false);
        expect(events).toEqual([]);

        expect(await s.remove(a.id)).toBe(true);
        expect(await s.removeByPid(8)).toBe(true);
        expect(broadcastPids()).toEqual([[8], []]);
    });

    for (const status of ["stopped", "gone", "reused"] as const) {
        it(`stop removes the record and broadcasts when the process is ${status}`, async () => {
            const s = service();
            const a = await s.add({ projectId: "p", pid: 7, label: "a" });
            events = [];
            outcome = { status };

            expect(await s.stop(a.id)).toEqual({ ok: true });
            expect(stopCalls).toEqual([{ pid: 7, registeredAt: a.registeredAt }]);
            expect(await s.list()).toEqual([]);
            expect(broadcastPids()).toEqual([[]]);
        });
    }

    it("a failed stop keeps the record, returns the error and broadcasts nothing", async () => {
        const s = service();
        const a = await s.add({ projectId: "p", pid: 7, label: "a" });
        events = [];
        outcome = { status: "failed", error: "Could not stop pid 7: operation not permitted" };

        expect(await s.stop(a.id)).toEqual({
            ok: false,
            error: "Could not stop pid 7: operation not permitted",
        });
        expect(await s.list()).toEqual([a]);
        expect(events).toEqual([]);
    });

    it("a stop leaves a re-registration of the same pid that landed while it ran", async () => {
        const pending: { finish?: (outcome: StopOutcome) => void } = {};
        const s = createDevServerService({
            store,
            broadcast: (event) => events.push(event),
            stopProcess: () =>
                new Promise<StopOutcome>((resolve) => {
                    pending.finish = resolve;
                }),
        });
        const old = await s.add({ projectId: "p", pid: 7, label: "old" });
        await Bun.sleep(5);

        const stopping = s.stop(old.id);
        while (!pending.finish) await Bun.sleep(1);
        const again = await s.add({ projectId: "p", pid: 7, label: "new" });
        events = [];
        pending.finish?.({ status: "reused" });

        expect(await stopping).toEqual({ ok: true });
        expect(again.id).toBe(old.id);
        expect(await s.list()).toEqual([again]);
        expect(events).toEqual([]);
    });

    it("stopping an unknown id is ok and signals nothing", async () => {
        expect(await service().stop("missing")).toEqual({ ok: true });
        expect(stopCalls).toEqual([]);
        expect(events).toEqual([]);
    });
});
