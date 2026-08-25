import { ScrollBoxRenderable, TextRenderable, type CliRenderer, type KeyEvent } from "@opentui/core";
import type { Notification } from "@taskflow/shared";
import { SELECTED_TEXT_STYLE } from "./selection-style";

interface NotificationsDeps {
    renderer: CliRenderer;
    notifications: readonly Notification[];
    onOpen(notification: Notification): void;
    onMarkRead(notification: Notification): void;
    onMarkAllRead(): void;
    onClearRead(): void;
    onClose(): void;
    onStateChange?(): void;
}

function sortedNotifications(notifications: readonly Notification[]): Notification[] {
    return [...notifications].sort(
        (left, right) => right.createdAt.localeCompare(left.createdAt) || right.id.localeCompare(left.id),
    );
}

class Notifications {
    readonly renderable: ScrollBoxRenderable;
    private notifications: Notification[];
    private selected = 0;
    private pending = false;
    private error: string | null = null;

    constructor(private readonly deps: NotificationsDeps) {
        this.notifications = sortedNotifications(deps.notifications);
        this.renderable = new ScrollBoxRenderable(deps.renderer, {
            id: "notifications",
            width: "100%",
            height: "100%",
            scrollY: true,
            scrollX: false,
            onMouseScroll: (event) => {
                const direction = event.scroll?.direction;
                if (direction !== "up" && direction !== "down") return;
                event.preventDefault();
                event.stopPropagation();
                this.move(direction === "up" ? -1 : 1);
            },
        });
        this.rebuild();
    }

    get selectedId(): string | null {
        return this.notifications[this.selected]?.id ?? null;
    }

    get keyHints(): string {
        return this.pending
            ? " Working..."
            : " ↑↓ Select  Enter Open  r Read  a Read all  x Clear read  Esc/q Sessions";
    }

    update(notifications: readonly Notification[]): void {
        const selectedId = this.selectedId;
        const previous = this.selected;
        this.notifications = sortedNotifications(notifications);
        const retained = selectedId
            ? this.notifications.findIndex((notification) => notification.id === selectedId)
            : -1;
        this.selected =
            retained >= 0
                ? retained
                : Math.min(previous, Math.max(0, this.notifications.length - 1));
        this.pending = false;
        this.rebuild();
    }

    setPending(pending: boolean): void {
        this.pending = pending;
        this.error = null;
        this.rebuild();
    }

    setError(error: string): void {
        this.pending = false;
        this.error = error;
        this.rebuild();
    }

    handleKey(event: KeyEvent): void {
        if (event.eventType !== "press" || this.pending) return;
        const chorded = event.ctrl || event.meta || event.option || event.super || event.hyper;
        if (chorded) return;
        if (event.name === "escape" || event.sequence === "q") return this.deps.onClose();
        if (event.name === "down" || event.sequence === "j") return this.move(1);
        if (event.name === "up" || event.sequence === "k") return this.move(-1);
        if (event.sequence === "a") return this.deps.onMarkAllRead();
        if (event.sequence === "x") return this.deps.onClearRead();
        const selected = this.notifications[this.selected];
        if (!selected) return;
        if (event.sequence === "r") return this.deps.onMarkRead(selected);
        if (event.name === "return" || event.name === "enter") this.deps.onOpen(selected);
    }

    private move(delta: number): void {
        if (this.notifications.length === 0) return;
        this.selected = Math.min(
            this.notifications.length - 1,
            Math.max(0, this.selected + delta),
        );
        this.error = null;
        this.rebuild();
    }

    private rebuild(): void {
        for (const child of [...this.renderable.getChildren()]) child.destroy();
        this.renderable.add(
            new TextRenderable(this.deps.renderer, { content: " Notifications", height: 1 }),
        );
        for (const [index, notification] of this.notifications.entries()) {
            const state = notification.read ? " " : "●";
            const timestamp = Number.isNaN(Date.parse(notification.createdAt))
                ? notification.createdAt
                : new Date(notification.createdAt).toISOString().replace("T", " ").slice(0, 16);
            this.renderable.add(
                new TextRenderable(this.deps.renderer, {
                    content: ` ${state} ${timestamp}  ${notification.message}`,
                    minHeight: 1,
                    wrapMode: "word",
                    ...(index === this.selected ? SELECTED_TEXT_STYLE : {}),
                }),
            );
        }
        if (this.notifications.length === 0) {
            this.renderable.add(
                new TextRenderable(this.deps.renderer, { content: " No notifications.", height: 1 }),
            );
        }
        if (this.pending) {
            this.renderable.add(new TextRenderable(this.deps.renderer, { content: " Working...", height: 1 }));
        } else if (this.error) {
            this.renderable.add(
                new TextRenderable(this.deps.renderer, {
                    content: ` ${this.error}`,
                    minHeight: 1,
                    wrapMode: "word",
                }),
            );
        }
        this.deps.onStateChange?.();
    }

    destroy(): void {
        this.renderable.destroy();
    }
}

export { Notifications, sortedNotifications };
export type { NotificationsDeps };
