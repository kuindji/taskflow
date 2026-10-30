import { expect, test } from "bun:test";
import { createReconnectPolicy } from "./reconnect-policy";

function harness(random = () => 0.5) {
    const timers: Array<{ run(): void; delay: number; cancelled: boolean }> = [];
    const results: Array<() => Promise<boolean>> = [];
    let calls = 0;
    const policy = createReconnectPolicy({
        random,
        schedule(run, delay) {
            const timer = { run, delay, cancelled: false };
            timers.push(timer);
            return () => {
                timer.cancelled = true;
            };
        },
        attempt() {
            calls++;
            return results.shift()?.() ?? Promise.resolve(false);
        },
    });
    const pending = () => timers.filter((t) => !t.cancelled);
    const fire = async (delay?: number) => {
        const timer = pending().find((t) => delay === undefined || t.delay === delay);
        if (!timer) throw new Error("No matching timer");
        timer.cancelled = true;
        timer.run();
        await flush();
    };
    return { policy, results, pending, fire, calls: () => calls };
}
async function flush() {
    for (let i = 0; i < 5; i++) await Promise.resolve();
}
function deferred() {
    let resolve!: (value: boolean) => void;
    const promise = new Promise<boolean>((r) => {
        resolve = r;
    });
    return { promise, resolve };
}

test("retries at one two four eight sixteen and thirty seconds", async () => {
    const h = harness();
    h.policy.start();
    h.policy.start();
    for (const delay of [1000, 2000, 4000, 8000, 16000, 30000, 30000]) {
        expect(h.pending().map((t) => t.delay)).toEqual([delay]);
        await h.fire();
    }
});
test("applies twenty percent jitter without exceeding thirty seconds", async () => {
    for (const [random, first] of [
        [0, 800],
        [1, 1200],
    ]) {
        const h = harness(() => random);
        h.policy.start();
        expect(h.pending()[0].delay).toBe(first);
        for (let i = 0; i < 8; i++) {
            expect(h.pending()[0].delay).toBeLessThanOrEqual(30000);
            await h.fire();
        }
    }
});
test("resets backoff only after sixty seconds of continuous connectivity", async () => {
    const h = harness();
    h.policy.start();
    await h.fire();
    h.results.push(() => Promise.resolve(true));
    await h.fire();
    h.policy.setConnected(true);
    h.policy.setConnected(true);
    expect(h.pending().map((t) => t.delay)).toEqual([60000]);
    await h.fire(60000);
    h.policy.setConnected(false);
    h.policy.start();
    expect(h.pending().map((t) => t.delay)).toEqual([1000]);
});
test("keeps backoff when the connection drops before sixty seconds", async () => {
    const h = harness();
    h.policy.start();
    await h.fire();
    h.results.push(() => Promise.resolve(true));
    await h.fire();
    h.policy.setConnected(true);
    h.policy.setConnected(false);
    h.policy.start();
    expect(h.pending().map((t) => t.delay)).toEqual([4000]);
});
test("retryNow cancels the old timer and attempts immediately", async () => {
    const h = harness();
    h.policy.retryNow();
    expect(h.calls()).toBe(0);
    h.policy.start();
    h.policy.retryNow();
    await flush();
    expect(h.calls()).toBe(1);
    expect(h.pending().map((t) => t.delay)).toEqual([2000]);
});
test("coalesces wake signals while an attempt is running", async () => {
    const h = harness();
    const d = deferred();
    h.results.push(() => d.promise);
    h.policy.start();
    await h.fire();
    h.policy.retryNow();
    h.policy.retryNow();
    h.policy.start();
    expect(h.calls()).toBe(1);
    d.resolve(false);
    await flush();
    expect(h.calls()).toBe(2);
    expect(h.pending().map((t) => t.delay)).toEqual([4000]);
    const success = deferred();
    h.results.push(() => success.promise);
    h.policy.retryNow();
    h.policy.retryNow();
    success.resolve(true);
    await flush();
    expect(h.calls()).toBe(3);
    expect(h.pending()).toEqual([]);
});
test("stop prevents timers and a late attempt from scheduling more work", async () => {
    const h = harness();
    const d = deferred();
    h.results.push(() => d.promise);
    h.policy.setConnected(true);
    h.policy.start();
    await h.fire(1000);
    h.policy.stop();
    d.resolve(false);
    await flush();
    h.policy.start();
    h.policy.retryNow();
    h.policy.setConnected(true);
    expect(h.pending()).toEqual([]);
    expect(h.calls()).toBe(1);
});
test("rejected attempts retry without an unhandled rejection", async () => {
    const h = harness();
    h.results.push(() => Promise.reject(new Error("offline")));
    h.policy.start();
    await h.fire();
    expect(h.pending().map((t) => t.delay)).toEqual([2000]);
});
