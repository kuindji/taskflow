import { expect, test } from "bun:test";
import { createBackendReconnects } from "./backend-reconnect";

function harness() {
    const wanted = new Set(["a", "b", "canonical"]);
    const calls: string[] = [];
    const timers: Array<{ run(): void; delay: number; cancelled: boolean }> = [];
    let attempt = (id: string): Promise<string | null> => {
        calls.push(id);
        return Promise.resolve(null);
    };
    const owner = createBackendReconnects({
        isWanted: (id) => wanted.has(id),
        attempt: (id) => attempt(id),
        random: () => 0.5,
        schedule(run, delay) {
            const timer = { run, delay, cancelled: false };
            timers.push(timer);
            return () => {
                timer.cancelled = true;
            };
        },
    });
    const pending = () => timers.filter((t) => !t.cancelled && t.delay !== 60000);
    const fire = async () => {
        for (const t of pending()) {
            t.cancelled = true;
            t.run();
        }
        await flush();
    };
    return {
        owner,
        wanted,
        calls,
        pending,
        fire,
        setAttempt: (fn: typeof attempt) => {
            attempt = fn;
        },
    };
}
async function flush() {
    for (let i = 0; i < 10; i++) await Promise.resolve();
}

test("a dropped wanted backend retries without a discovery beacon", async () => {
    const h = harness();
    h.owner.lost("a");
    await h.fire();
    expect(h.calls).toEqual(["a"]);
    expect(h.pending()[0].delay).toBe(2000);
});
test("two remote backends recover independently", async () => {
    const h = harness();
    h.setAttempt((id) => {
        h.calls.push(id);
        return Promise.resolve(id === "a" ? id : null);
    });
    h.owner.lost("a");
    h.owner.lost("b");
    await h.fire();
    await h.fire();
    expect(h.calls).toEqual(["a", "b", "b"]);
});
test("a detached or removed backend never starts another attempt", async () => {
    const h = harness();
    h.owner.lost("unknown");
    h.owner.lost("a");
    h.owner.remove("a");
    h.owner.lost("b");
    h.wanted.delete("b");
    await h.fire();
    expect(h.calls).toEqual([]);
    expect(h.pending()).toEqual([]);
});
test("a canonical id rename keeps one reconnect controller", async () => {
    const h = harness();
    h.owner.lost("a");
    await h.fire();
    h.owner.rekey("a", "canonical");
    h.wanted.delete("a");
    h.owner.retryNow("canonical");
    await flush();
    expect(h.calls).toEqual(["a", "canonical"]);
    expect(h.pending().map((t) => t.delay)).toEqual([4000]);
});
test("merging an alias keeps only the canonical reconnect controller", async () => {
    const h = harness();
    h.owner.lost("a");
    h.owner.lost("canonical");
    await h.fire();
    h.owner.rekey("a", "canonical");
    h.wanted.delete("a");
    await h.fire();
    expect(h.calls).toEqual(["a", "canonical", "canonical"]);
    expect(h.pending()).toHaveLength(1);
});
test("manual retry and a beacon share the pending attempt", async () => {
    const h = harness();
    let resolve!: (id: string | null) => void;
    h.setAttempt((id) => {
        h.calls.push(id);
        return new Promise((r) => {
            resolve = r;
        });
    });
    h.owner.lost("a");
    h.owner.retryNow("a");
    h.owner.retryNow("a");
    h.owner.retryNow();
    expect(h.calls).toEqual(["a"]);
    resolve("a");
    await flush();
    expect(h.calls).toEqual(["a"]);
    expect(h.pending()).toEqual([]);
});
test("a failed bootstrap does not count as a successful reconnect", async () => {
    const h = harness();
    h.owner.lost("a");
    await h.fire();
    expect(h.pending()).toHaveLength(1);
    h.setAttempt(() => Promise.reject(new Error("bridge failed")));
    await h.fire();
    expect(h.pending()[0].delay).toBe(4000);
    h.owner.dispose();
    expect(h.pending()).toEqual([]);
    h.owner.lost("a");
    expect(h.pending()).toEqual([]);
});
