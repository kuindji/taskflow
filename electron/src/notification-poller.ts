import { BrowserWindow, Notification } from "electron";

interface NotificationPollerDeps {
    getMainWindow: () => BrowserWindow | null;
    getBackendPort: () => number | null;
}

let lastNotificationCheck: string | null = null;
let notificationPollTimer: ReturnType<typeof setInterval> | null = null;
let deps: NotificationPollerDeps;

function initNotificationPoller(d: NotificationPollerDeps): void {
    deps = d;
}

interface BackendNotification {
    id: string;
    projectId: string;
    sessionId: string;
    taskId?: string;
    message: string;
    read: boolean;
    createdAt: string;
}

async function checkNewNotifications(): Promise<void> {
    const port = deps.getBackendPort();
    if (!port) return;

    try {
        const response = await fetch(`http://127.0.0.1:${port}/api/notifications`, {
            signal: AbortSignal.timeout(2000),
        });
        if (!response.ok) return;

        const { notifications } = (await response.json()) as {
            notifications: BackendNotification[];
        };

        let newestShown = lastNotificationCheck;

        for (const n of notifications) {
            if (!n.read && (!lastNotificationCheck || n.createdAt > lastNotificationCheck)) {
                const desktopNotification = new Notification({
                    title: "Taskflow",
                    body: n.message,
                });
                desktopNotification.on("click", () => {
                    const mainWindow = deps.getMainWindow();
                    if (mainWindow) {
                        if (!mainWindow.isVisible()) mainWindow.show();
                        mainWindow.focus();
                        mainWindow.webContents.send("notification-clicked", {
                            id: n.id,
                            projectId: n.projectId,
                            sessionId: n.sessionId,
                            taskId: n.taskId,
                        });
                    }
                });
                desktopNotification.show();

                if (!newestShown || n.createdAt > newestShown) {
                    newestShown = n.createdAt;
                }
            }
        }

        if (newestShown) {
            lastNotificationCheck = newestShown;
        }
    } catch {
        // Ignore transient failures
    }
}

function startNotificationPolling(): void {
    if (notificationPollTimer) return;
    lastNotificationCheck = new Date().toISOString();
    notificationPollTimer = setInterval(() => {
        void checkNewNotifications();
    }, 3000);
}

function stopNotificationPolling(): void {
    if (!notificationPollTimer) return;
    clearInterval(notificationPollTimer);
    notificationPollTimer = null;
}

export { initNotificationPoller, startNotificationPolling, stopNotificationPolling };
