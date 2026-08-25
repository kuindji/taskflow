import { describe, expect, test } from "bun:test";
import type { Notification } from "@taskflow/shared";
import { APPLESCRIPT, deliverNativeNotification, type NotificationDeliveryDeps } from "./deliver";

const notification: Notification = {
    id: "n1",
    projectId: "p1",
    sessionId: "s1",
    message: 'done" & do shell script "touch /tmp/no"',
    read: false,
    createdAt: "2026-08-25T00:00:00.000Z",
};

function deps(platform: NodeJS.Platform, available: string | null) {
    const calls: string[][] = [];
    const value: NotificationDeliveryDeps = {
        platform,
        which: () => available,
        spawn: async (args) => {
            calls.push(args);
            return 0;
        },
        title: "Taskflow",
    };
    return { deps: value, calls };
}

describe("native notification delivery", () => {
    test("passes Linux text as process arguments without a shell", async () => {
        const test = deps("linux", "/usr/bin/notify-send");
        await deliverNativeNotification(notification, test.deps);
        expect(test.calls).toEqual([["notify-send", "Taskflow", notification.message]]);
    });

    test("passes macOS text through argv instead of interpolating AppleScript", async () => {
        const test = deps("darwin", "/usr/bin/osascript");
        await deliverNativeNotification(notification, test.deps);
        expect(test.calls[0]?.slice(0, 7)).toEqual([
            "osascript",
            "-e",
            APPLESCRIPT[0],
            "-e",
            APPLESCRIPT[1],
            "-e",
            APPLESCRIPT[2],
        ]);
        expect(test.calls[0]?.slice(7)).toEqual([notification.message, "Taskflow"]);
        expect(APPLESCRIPT.join(" ")).not.toContain(notification.message);
    });

    test("silently keeps in-app delivery when no host tool exists or spawn fails", async () => {
        const missing = deps("linux", null);
        await deliverNativeNotification(notification, missing.deps);
        expect(missing.calls).toEqual([]);
        expect(
            deliverNativeNotification(notification, {
                ...missing.deps,
                which: () => "/usr/bin/notify-send",
                spawn: () => Promise.reject(new Error("missing")),
            }),
        ).resolves.toBeUndefined();
    });
});
