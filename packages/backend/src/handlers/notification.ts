import { MSG } from "@taskflow/shared";
import type {
    NotificationMarkReadPayload,
    NotificationDeletePayload,
    WsEvent,
} from "@taskflow/shared";
import type { Router } from "../ws/router";
import type { NotificationStore } from "../services/notification-store";

interface NotificationHandlerDeps {
    router: Router;
    notificationStore: NotificationStore;
    broadcast: (event: WsEvent) => void;
}

// Same typed-handler pattern as schedule.ts
// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters -- T narrows payload inside each handler callback
function typed<T>(
    handler: (payload: T) => Promise<unknown>,
): (payload: unknown) => Promise<unknown> {
    return handler as (payload: unknown) => Promise<unknown>;
}

export function registerNotificationHandlers(deps: NotificationHandlerDeps): void {
    const { router, notificationStore, broadcast } = deps;

    router.register(MSG.NOTIFICATION_LIST, async () => {
        const notifications = await notificationStore.list();
        return { notifications };
    });

    router.register(
        MSG.NOTIFICATION_UPDATED,
        typed<NotificationMarkReadPayload>(async (payload) => {
            const notification = await notificationStore.markAsRead(payload.id);
            if (!notification) throw new Error("Notification not found");
            broadcast({ type: MSG.NOTIFICATION_UPDATED, payload: { notification } });
            return { notification };
        }),
    );

    router.register(
        MSG.NOTIFICATION_DELETED,
        typed<NotificationDeletePayload>(async (payload) => {
            if (payload.all) {
                await notificationStore.deleteAll();
                broadcast({ type: MSG.NOTIFICATION_DELETED, payload: { all: true } });
            } else if (payload.id) {
                const deleted = await notificationStore.delete(payload.id);
                if (!deleted) throw new Error("Notification not found");
                broadcast({ type: MSG.NOTIFICATION_DELETED, payload: { id: payload.id } });
            }
            return { success: true };
        }),
    );
}
