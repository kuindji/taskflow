import { expect, test } from "bun:test";
import { EventEmitter } from "node:events";
import { installRemoteWakeup } from "./remote-wakeup";

test("resume requests an immediate remote retry", () => {
    const source = new EventEmitter();
    let calls = 0;
    const dispose = installRemoteWakeup({
        source,
        notify: () => {
            calls++;
        },
    });
    source.emit("resume");
    expect(calls).toBe(1);
    dispose();
});

test("disposing the wake listener stops resume notifications", () => {
    const source = new EventEmitter();
    let calls = 0;
    const other = () => {
        calls += 10;
    };
    source.on("resume", other);
    const dispose = installRemoteWakeup({
        source,
        notify: () => {
            calls++;
        },
    });
    dispose();
    dispose();
    source.emit("resume");
    expect(calls).toBe(10);
    expect(source.listeners("resume")).toEqual([other]);
});
