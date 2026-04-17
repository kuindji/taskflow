import { describe, expect, it } from "bun:test";
import { ConnectivityService } from "../../src/services/connectivity-service";

describe("ConnectivityService", () => {
    it("updates online state and notifies listeners on manual refresh", async () => {
        const states = [false, true];
        const service = new ConnectivityService(async () => states.shift() ?? true);
        const seen: boolean[] = [];

        expect(await service.init()).toBe(false);

        service.onChange((online) => {
            seen.push(online);
        });

        expect(await service.refresh()).toBe(true);
        expect(service.isOnline).toBe(true);
        expect(seen).toEqual([true]);

        service.shutdown();
    });

    it("deduplicates concurrent refresh calls", async () => {
        let calls = 0;
        const service = new ConnectivityService(async () => {
            calls += 1;
            return await new Promise<boolean>((resolve) => {
                setTimeout(() => resolve(true), 0);
            });
        });

        await service.init();

        const [first, second] = await Promise.all([service.refresh(), service.refresh()]);

        expect(first).toBe(true);
        expect(second).toBe(true);
        expect(calls).toBe(2);

        service.shutdown();
    });
});
