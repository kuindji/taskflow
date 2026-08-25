import type { Notification } from "@taskflow/shared";

interface NotificationDeliveryDeps {
    platform: NodeJS.Platform;
    which(command: string): string | null;
    spawn(args: string[]): Promise<number>;
    title: string;
}

const APPLESCRIPT = [
    "on run argv",
    "display notification (item 1 of argv) with title (item 2 of argv)",
    "end run",
];

function defaultDeliveryDeps(title = "Taskflow"): NotificationDeliveryDeps {
    return {
        platform: process.platform,
        which: (command) => Bun.which(command),
        spawn: async (args) => {
            const child = Bun.spawn(args, { stdin: "ignore", stdout: "ignore", stderr: "ignore" });
            return child.exited;
        },
        title,
    };
}

async function deliverNativeNotification(
    notification: Notification,
    deps: NotificationDeliveryDeps = defaultDeliveryDeps(),
): Promise<void> {
    let args: string[] | null = null;
    if (deps.platform === "linux" && deps.which("notify-send")) {
        args = ["notify-send", deps.title, notification.message];
    } else if (deps.platform === "darwin" && deps.which("osascript")) {
        args = [
            "osascript",
            "-e",
            APPLESCRIPT[0],
            "-e",
            APPLESCRIPT[1],
            "-e",
            APPLESCRIPT[2],
            notification.message,
            deps.title,
        ];
    }
    if (!args) return;
    try {
        await deps.spawn(args);
    } catch {
        // Native delivery is best effort. The in-app unread state is authoritative.
    }
}

export { APPLESCRIPT, defaultDeliveryDeps, deliverNativeNotification };
export type { NotificationDeliveryDeps };
