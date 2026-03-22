import { describe, expect, test } from "bun:test";
import { TrayStateTracker } from "../tray-state-tracker";

describe("TrayStateTracker", () => {
    test("marks activity-tracked sessions as working and then attention", async () => {
        const tracker = new TrayStateTracker({ activityTimeoutMs: 10 });
        tracker.registerSession("session-1", "codex");

        tracker.markSessionActivity("session-1");
        expect(tracker.getAggregateState()).toBe("working");

        await Bun.sleep(20);
        expect(tracker.getAggregateState()).toBe("attention");
    });

    test("ignores terminal output for shell sessions", async () => {
        const tracker = new TrayStateTracker({ activityTimeoutMs: 10 });
        tracker.registerSession("session-1", "shell");

        tracker.markSessionActivity("session-1");
        await Bun.sleep(20);

        expect(tracker.getAggregateState()).toBeNull();
    });

    test("clears sessions on exit", () => {
        const tracker = new TrayStateTracker();
        tracker.registerSession("session-1", "codex");
        tracker.setSessionStatus("session-1", "attention");

        tracker.clearSession("session-1");

        expect(tracker.getAggregateState()).toBeNull();
    });
});
