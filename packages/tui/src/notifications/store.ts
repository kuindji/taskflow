import { MSG } from "@taskflow/shared";
import type {
    Notification,
    NotificationCreatedEvent,
    NotificationDeletedEvent,
    NotificationListResponse,
    NotificationUpdatedEvent,
} from "@taskflow/shared";
import type { NetLike } from "../net/client";

type DeliverNotification = (notification: Notification) => void | Promise<void>;

function upsert(items: readonly Notification[], notification: Notification): Notification[] {
    const index = items.findIndex((item) => item.id === notification.id);
    if (index < 0) return [...items, notification];
    const copy = [...items];
    copy[index] = notification;
    return copy;
}

class NotificationStore {
    private notificationList: Notification[] = [];
    private readonly listeners = new Set<() => void>();
    private readonly disposers: (() => void)[] = [];
    private deferred: Array<{ mutation(): void; deliver?: Notification }> | null = null;
    private loadToken = 0;
    private disposed = false;

    constructor(
        private readonly net: NetLike,
        private readonly deliver: DeliverNotification = () => undefined,
    ) {
        this.disposers.push(
            net.on(MSG.NOTIFICATION_CREATED, (payload) => {
                const event = payload as Partial<NotificationCreatedEvent>;
                if (!event.notification) return;
                const notification = event.notification;
                this.apply(
                    () => {
                        this.notificationList = upsert(this.notificationList, notification);
                    },
                    notification,
                );
            }),
            net.on(MSG.NOTIFICATION_UPDATED, (payload) => {
                const event = payload as Partial<NotificationUpdatedEvent>;
                if (!event.notification) return;
                const notification = event.notification;
                this.apply(() => {
                    this.notificationList = upsert(this.notificationList, notification);
                });
            }),
            net.on(MSG.NOTIFICATION_DELETED, (payload) => {
                const event = payload as NotificationDeletedEvent;
                this.apply(() => {
                    this.notificationList = event.all
                        ? []
                        : this.notificationList.filter((item) => item.id !== event.id);
                });
            }),
        );
    }

    get notifications(): readonly Notification[] {
        return this.notificationList;
    }

    get unreadCount(): number {
        return this.notificationList.filter((notification) => !notification.read).length;
    }

    onChange(listener: () => void): () => void {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    private notify(): void {
        if (this.disposed) return;
        for (const listener of [...this.listeners]) listener();
    }

    private apply(mutation: () => void, deliver?: Notification): void {
        if (this.deferred) {
            this.deferred.push({ mutation, deliver });
            return;
        }
        mutation();
        this.notify();
        if (deliver) void Promise.resolve(this.deliver(deliver)).catch(() => undefined);
    }

    async load(): Promise<void> {
        const token = ++this.loadToken;
        const mark = (this.deferred ??= []).length;
        let committed = false;
        try {
            const response = await this.net.request<NotificationListResponse>(MSG.NOTIFICATION_LIST);
            if (this.disposed || token !== this.loadToken) return;
            this.notificationList = response.notifications;
            committed = true;
        } finally {
            if (!this.disposed && token === this.loadToken) {
                const deferred = this.deferred ?? [];
                this.deferred = null;
                const retained = committed ? deferred.slice(mark) : deferred;
                for (const event of retained) event.mutation();
                this.notify();
                for (const event of retained) {
                    if (event.deliver) {
                        void Promise.resolve(this.deliver(event.deliver)).catch(() => undefined);
                    }
                }
            }
        }
    }

    async markRead(id: string): Promise<void> {
        await this.net.request(MSG.NOTIFICATION_UPDATED, { id });
    }

    async markAllRead(): Promise<void> {
        await Promise.all(
            this.notificationList
                .filter((notification) => !notification.read)
                .map((notification) => this.markRead(notification.id)),
        );
    }

    async clearRead(): Promise<void> {
        await Promise.all(
            this.notificationList
                .filter((notification) => notification.read)
                .map((notification) =>
                    this.net.request(MSG.NOTIFICATION_DELETED, { id: notification.id }),
                ),
        );
    }

    dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        this.loadToken++;
        this.deferred = null;
        for (const dispose of this.disposers) dispose();
        this.disposers.length = 0;
        this.listeners.clear();
    }
}

export { NotificationStore, upsert };
export type { DeliverNotification };
