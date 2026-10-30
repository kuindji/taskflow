import { describe, expect, it } from "bun:test";
import type { TerminalResyncEvent } from "@taskflow/shared";
import { subscribeTerminalRecovery } from "./terminal-attachment";

function fixture() {
    let backendId = "provisional";
    let calls = 0;
    const resyncHandlers = new Set<(event: TerminalResyncEvent, backendId: string) => void>();
    const readyHandlers = new Set<(backendId: string) => void>();
    const dispose = subscribeTerminalRecovery({
        sessionId: "s1",
        backendId: () => backendId,
        onResync(handler) {
            resyncHandlers.add(handler);
            return () => {
                resyncHandlers.delete(handler);
            };
        },
        onReady(handler) {
            readyHandlers.add(handler);
            return () => {
                readyHandlers.delete(handler);
            };
        },
        resync() {
            calls++;
            return Promise.reject(new Error("offline"));
        },
    });
    return {
        dispose,
        resyncHandlers,
        readyHandlers,
        calls: () => calls,
        rename() {
            backendId = "canonical";
        },
        resync(sessionIds: string[], id: string) {
            for (const h of resyncHandlers) h({ sessionIds }, id);
        },
        ready(id: string) {
            for (const h of readyHandlers) h(id);
        },
    };
}
describe("terminal recovery subscriptions", () => {
    it("terminal resync requests attachment only for listed sessions on the emitting backend", () => {
        const f = fixture();
        f.rename();
        f.resync(["s1"], "provisional");
        f.resync(["s2"], "canonical");
        expect(f.calls()).toBe(0);
        f.resync(["s1", "s2"], "canonical");
        expect(f.calls()).toBe(1);
        f.dispose();
    });
    it("backend ready requests a fresh attachment even when no new output arrives", () => {
        const f = fixture();
        f.rename();
        f.ready("provisional");
        expect(f.calls()).toBe(0);
        f.ready("canonical");
        expect(f.calls()).toBe(1);
        f.dispose();
    });
    it("disposing a cached terminal removes resync and ready subscriptions", () => {
        const f = fixture();
        f.dispose();
        expect(f.resyncHandlers.size).toBe(0);
        expect(f.readyHandlers.size).toBe(0);
        f.ready("provisional");
        f.resync(["s1"], "provisional");
        expect(f.calls()).toBe(0);
    });
});
