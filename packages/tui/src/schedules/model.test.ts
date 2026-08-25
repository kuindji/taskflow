import { describe, expect, it } from "bun:test";
import type { Schedule } from "@taskflow/shared";
import { scheduleStatusText } from "./model";

const base: Schedule = {
    id: "s1",
    projectId: "p1",
    name: "Schedule",
    prompt: "echo ok",
    expression: "5m",
    expressionType: "rate",
    timeout: 30,
    enabled: true,
    lastRunAt: null,
    lastError: null,
    nextRunAt: null,
    runningSessionId: null,
    createdAt: "now",
    updatedAt: "now",
};

describe("scheduleStatusText", () => {
    it("prefers running, disabled, and error states before scheduled", () => {
        expect(scheduleStatusText({ ...base, runningSessionId: "session" })).toBe("Running");
        expect(scheduleStatusText({ ...base, enabled: false })).toBe("Disabled");
        expect(scheduleStatusText({ ...base, lastError: "failed" })).toBe("Error");
        expect(scheduleStatusText(base)).toBe("Scheduled");
    });
});
