import { expect, test } from "bun:test";
import { EventEmitter } from "node:events";
import { BACKEND_RESTART_EXIT_CODE } from "@taskflow/shared";
import { watchBackendRestart } from "./backend-restart";

test("a backend exiting with the restart code asks for a restart", () => {
    const backend = new EventEmitter();
    let restarts = 0;
    watchBackendRestart(backend, () => restarts++);
    backend.emit("exit", BACKEND_RESTART_EXIT_CODE);
    expect(restarts).toBe(1);
});

test("a backend killed, crashing or exiting normally does not", () => {
    for (const code of [null, 0, 1]) {
        const backend = new EventEmitter();
        let restarts = 0;
        watchBackendRestart(backend, () => restarts++);
        backend.emit("exit", code);
        expect(restarts).toBe(0);
    }
});
