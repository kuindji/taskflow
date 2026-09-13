import { create } from "zustand";
import type {
    Notification,
    NotificationCreatedEvent,
    NotificationUpdatedEvent,
    NotificationDeletedEvent,
    NotificationListResponse,
} from "@taskflow/shared";
import { MSG } from "@taskflow/shared";
import { createSlices, type Scoped } from "@/lib/backend-scope";
import { onEvent, sendRequest } from "@/lib/connection-registry";
import { registerBackendReset } from "./store-reset";

interface NotificationStoreState {
    notifications: Scoped<Notification>[];
    loading: boolean;
    selectedNotificationId: string | null;

    fetchNotifications(backendId: string): Promise<void>;
    markAsRead(notification: Scoped<Notification>): Promise<void>;
    deleteNotification(notification: Scoped<Notification>): Promise<void>;
    deleteAll(): Promise<void>;
    setSelectedNotificationId(id: string | null): void;
}

const slices = createSlices<Notification>();

function publish(): void {
    useNotificationStore.setState({ notifications: slices.read() });
}

const useNotificationStore = create<NotificationStoreState>((set) => ({
    notifications: [],
    loading: false,
    selectedNotificationId: null,

    async fetchNotifications(backendId) {
        set({ loading: true });
        try {
            const landed = await slices.load(backendId, async () => {
                const { notifications } = await sendRequest<NotificationListResponse>(
                    backendId,
                    MSG.NOTIFICATION_LIST,
                    {},
                );
                return notifications;
            });
            if (landed) publish();
        } finally {
            set({ loading: false });
        }
    },

    async markAsRead(notification) {
        await sendRequest(notification.backendId, MSG.NOTIFICATION_UPDATED, {
            id: notification.id,
        });
    },

    async deleteNotification(notification) {
        await sendRequest(notification.backendId, MSG.NOTIFICATION_DELETED, {
            id: notification.id,
        });
    },

    async deleteAll() {
        // The list shows every attached machine's notifications, so clearing it
        // must clear every attached machine. Sending { all: true } to one
        // backend would present a merged list and empty one slice of it.
        await Promise.allSettled(
            slices
                .backends()
                .map((backendId) =>
                    sendRequest(backendId, MSG.NOTIFICATION_DELETED, { all: true }),
                ),
        );
    },

    setSelectedNotificationId(id) {
        set({ selectedNotificationId: id });
    },
}));

registerBackendReset("notification-store", (backendId) => {
    slices.drop(backendId);
    publish();
});

const _unsubNotificationCreated = onEvent(MSG.NOTIFICATION_CREATED, (payload, backendId) => {
    const event = payload as NotificationCreatedEvent;
    const created = event.notification;
    if (!created) return;
    // Inside the write: a list response may already hold it when this is replayed.
    slices.apply(backendId, (items) =>
        items.some((n) => n.id === created.id) ? items : [...items, { ...created, backendId }],
    );
    publish();
});

const _unsubNotificationUpdated = onEvent(MSG.NOTIFICATION_UPDATED, (payload, backendId) => {
    const event = payload as NotificationUpdatedEvent;
    const updated = event.notification;
    if (!updated) return;
    slices.apply(backendId, (items) =>
        items.map((n) => (n.id === updated.id ? { ...updated, backendId } : n)),
    );
    publish();
});

const _unsubNotificationDeleted = onEvent(MSG.NOTIFICATION_DELETED, (payload, backendId) => {
    const event = payload as NotificationDeletedEvent;
    if (event.all) {
        // Remove what the machine held when it cleared, not everything: replayed
        // over a list answered after the clear, `() => []` would also erase the
        // notifications created since.
        const cleared = new Set(
            slices
                .read()
                .filter((n) => n.backendId === backendId)
                .map((n) => n.id),
        );
        slices.apply(backendId, (items) => items.filter((n) => !cleared.has(n.id)));
    } else if (event.id) {
        const deletedId = event.id;
        slices.apply(backendId, (items) => items.filter((n) => n.id !== deletedId));
    }
    publish();
});

export { useNotificationStore };

if (import.meta.hot) {
    import.meta.hot.dispose(() => {
        _unsubNotificationCreated();
        _unsubNotificationUpdated();
        _unsubNotificationDeleted();
    });
}
