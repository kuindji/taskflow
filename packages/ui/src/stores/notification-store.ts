import { create } from "zustand";
import type {
    Notification,
    NotificationCreatedEvent,
    NotificationUpdatedEvent,
    NotificationDeletedEvent,
} from "@taskflow/shared";
import { MSG } from "@taskflow/shared";
import { sendRequest, onEvent } from "../hooks/useWebSocket";

interface NotificationStoreState {
    notifications: Notification[];
    loading: boolean;

    fetchNotifications(): Promise<void>;
    markAsRead(id: string): Promise<void>;
    deleteNotification(id: string): Promise<void>;
    deleteAll(): Promise<void>;
}

const useNotificationStore = create<NotificationStoreState>((set) => ({
    notifications: [],
    loading: false,

    async fetchNotifications() {
        set({ loading: true });
        try {
            const { notifications } = await sendRequest<{ notifications: Notification[] }>(
                MSG.NOTIFICATION_LIST,
                {},
            );
            set({ notifications });
        } finally {
            set({ loading: false });
        }
    },

    async markAsRead(id) {
        await sendRequest(MSG.NOTIFICATION_UPDATED, { id });
    },

    async deleteNotification(id) {
        await sendRequest(MSG.NOTIFICATION_DELETED, { id });
    },

    async deleteAll() {
        await sendRequest(MSG.NOTIFICATION_DELETED, { all: true });
    },
}));

// Module-level event listeners (same pattern as schedule-store.ts)
const _unsubNotificationCreated = onEvent(MSG.NOTIFICATION_CREATED, (payload) => {
    const event = payload as NotificationCreatedEvent;
    if (event.notification) {
        useNotificationStore.setState((s) => ({
            notifications: [...s.notifications, event.notification],
        }));
    }
});

const _unsubNotificationUpdated = onEvent(MSG.NOTIFICATION_UPDATED, (payload) => {
    const event = payload as NotificationUpdatedEvent;
    if (event.notification) {
        useNotificationStore.setState((s) => ({
            notifications: s.notifications.map((n) =>
                n.id === event.notification.id ? event.notification : n,
            ),
        }));
    }
});

const _unsubNotificationDeleted = onEvent(MSG.NOTIFICATION_DELETED, (payload) => {
    const event = payload as NotificationDeletedEvent;
    if (event.all) {
        useNotificationStore.setState({ notifications: [] });
    } else if (event.id) {
        const deletedId = event.id;
        useNotificationStore.setState((s) => ({
            notifications: s.notifications.filter((n) => n.id !== deletedId),
        }));
    }
});

export { useNotificationStore };

if (import.meta.hot) {
    import.meta.hot.dispose(() => {
        _unsubNotificationCreated();
        _unsubNotificationUpdated();
        _unsubNotificationDeleted();
    });
}
