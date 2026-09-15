import { describe, expect, it } from "bun:test";
import { MSG } from "@taskflow/shared";
import { FakeNet } from "../opentui/test-helpers";
import { MachineOfflineError, OfflineGuardNet } from "./offline-guard";

describe("OfflineGuardNet", () => {
    it("refuses requests while offline without reaching the inner client", async () => {
        const inner = new FakeNet();
        inner.responses.set(MSG.TASK_CREATE, { id: "t1" });
        const guard = new OfflineGuardNet(inner);

        guard.offline = true;
        const refused = await guard
            .request(MSG.TASK_CREATE, { title: "x" })
            .catch((error: unknown) => error);
        expect(refused).toBeInstanceOf(MachineOfflineError);
        expect(inner.requests).toEqual([]);

        guard.offline = false;
        expect(await guard.request<{ id: string }>(MSG.TASK_CREATE, { title: "x" })).toEqual({
            id: "t1",
        });
        expect(inner.requests).toEqual([{ type: MSG.TASK_CREATE, payload: { title: "x" } }]);
    });

    it("passes events and status changes through while offline", () => {
        const inner = new FakeNet();
        const guard = new OfflineGuardNet(inner);
        guard.offline = true;
        const events: unknown[] = [];
        const statuses: boolean[] = [];
        const offEvent = guard.on(MSG.SYSTEM_CLIENTS, (payload) => events.push(payload));
        const offStatus = guard.onStatusChange(({ connected }) => statuses.push(connected));

        inner.emit(MSG.SYSTEM_CLIENTS, { count: 2 });
        inner.emitStatus(true);
        offEvent();
        offStatus();
        inner.emit(MSG.SYSTEM_CLIENTS, { count: 3 });
        inner.emitStatus(false);

        expect(events).toEqual([{ count: 2 }]);
        expect(statuses).toEqual([true]);
    });
});
