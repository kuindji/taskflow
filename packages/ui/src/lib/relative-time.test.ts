import { describe, expect, test } from "bun:test";
import { formatRelativeTime } from "./relative-time";

function ago(ms: number): string {
    return new Date(Date.now() - ms).toISOString();
}

describe("formatRelativeTime", () => {
    test("rounds down through seconds, minutes, hours and days", () => {
        expect(formatRelativeTime(ago(30_000))).toBe("just now");
        expect(formatRelativeTime(ago(5 * 60_000))).toBe("5m ago");
        expect(formatRelativeTime(ago(2 * 3_600_000))).toBe("2h ago");
        expect(formatRelativeTime(ago(3 * 86_400_000))).toBe("3d ago");
    });
});
