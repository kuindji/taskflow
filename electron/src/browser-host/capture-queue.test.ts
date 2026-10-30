import { expect, test } from "bun:test";
import { createCaptureQueue } from "./capture-queue";

test("captures run one at a time and return their images", async () => {
    const enqueue = createCaptureQueue(1000);
    const started: string[] = [];
    let finishFirst = (_image: string) => {};
    const first = enqueue(() => {
        started.push("first");
        return new Promise<string>((resolve) => {
            finishFirst = resolve;
        });
    });
    const second = enqueue(async () => {
        started.push("second");
        return "image-2";
    });
    await Bun.sleep(5);
    expect(started).toEqual(["first"]);
    finishFirst("image-1");
    expect(await first).toBe("image-1");
    expect(await second).toBe("image-2");
    expect(started).toEqual(["first", "second"]);
});

test("a capture that never settles doesn't stall the callers behind it", async () => {
    const enqueue = createCaptureQueue(20);
    const started: string[] = [];
    const first = enqueue(() => {
        started.push("first");
        return new Promise<string>(() => {});
    });
    const second = enqueue(async () => {
        started.push("second");
        return "image-2";
    });
    const at = performance.now();
    expect(await first).toBe("");
    expect(await second).toBe("");
    expect(performance.now() - at).toBeLessThan(200);
    expect(started).toEqual(["first"]);
});

test("a failed capture gives an empty image and the queue moves on", async () => {
    const enqueue = createCaptureQueue(1000);
    const first = enqueue(() => Promise.reject(new Error("capture failed")));
    const second = enqueue(async () => "image-2");
    expect(await first).toBe("");
    expect(await second).toBe("image-2");
});
