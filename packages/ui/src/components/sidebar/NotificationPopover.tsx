import type { ReactNode } from "react";
import type { Notification } from "@taskflow/shared";
import { useNotificationStore } from "../../stores/notification-store";
import { useProjectStore } from "../../stores/project-store";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";
import { Button } from "../ui/button";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

function formatRelativeTime(dateStr: string): string {
    const seconds = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
    if (seconds < 60) return "just now";
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
}

interface NotificationPopoverProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onNavigate: (notification: Notification) => void;
    children: ReactNode;
}

function NotificationPopover({
    open,
    onOpenChange,
    onNavigate,
    children,
}: NotificationPopoverProps) {
    const notifications = useNotificationStore((s) => s.notifications);
    const markAsRead = useNotificationStore((s) => s.markAsRead);
    const deleteNotification = useNotificationStore((s) => s.deleteNotification);
    const deleteAll = useNotificationStore((s) => s.deleteAll);
    const projects = useProjectStore((s) => s.projects);

    const sorted = [...notifications].sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );

    function getProjectName(projectId: string): string {
        return projects.find((p) => p.id === projectId)?.name ?? projectId;
    }

    function handleItemClick(notification: Notification) {
        if (!notification.read) {
            void markAsRead(notification.id);
        }
        onNavigate(notification);
        onOpenChange(false);
    }

    function handleDelete(e: React.MouseEvent, notification: Notification) {
        e.stopPropagation();
        void deleteNotification(notification.id);
    }

    function handleDismissAll() {
        void deleteAll();
    }

    return (
        <Popover open={open} onOpenChange={onOpenChange}>
            <PopoverTrigger asChild>{children}</PopoverTrigger>
            <PopoverContent
                side="right"
                align="end"
                sideOffset={8}
                className="w-80 p-0">
                <div className="flex items-center justify-between border-b px-3 py-2">
                    <span className="text-sm font-medium">Notifications</span>
                    <Button
                        variant="ghost"
                        size="xs"
                        onClick={handleDismissAll}
                        className="text-muted-foreground text-xs [-webkit-app-region:no-drag]">
                        Dismiss all
                    </Button>
                </div>
                <div className="max-h-80 overflow-y-auto">
                    {sorted.length === 0 ? (
                        <div className="text-muted-foreground px-3 py-4 text-sm">
                            No notifications
                        </div>
                    ) : (
                        sorted.map((notification) => (
                            <button
                                key={notification.id}
                                type="button"
                                onClick={() => handleItemClick(notification)}
                                className={cn(
                                    "hover:bg-accent/50 flex w-full items-start gap-2 px-3 py-2 text-left transition-colors [-webkit-app-region:no-drag]",
                                    !notification.read && "bg-accent/20",
                                )}>
                                <span
                                    className={cn(
                                        "mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full",
                                        notification.read
                                            ? "bg-transparent"
                                            : "bg-accent",
                                    )}
                                />
                                <div className="min-w-0 flex-1">
                                    <p className="text-foreground truncate text-sm">
                                        {notification.message}
                                    </p>
                                    <p className="text-muted-foreground mt-0.5 text-xs">
                                        {getProjectName(notification.projectId)} ·{" "}
                                        {formatRelativeTime(notification.createdAt)}
                                    </p>
                                </div>
                                <Button
                                    variant="ghost"
                                    size="icon-2xs"
                                    onClick={(e) => handleDelete(e, notification)}
                                    aria-label="Delete notification"
                                    className="text-muted-foreground mt-0.5 shrink-0 [-webkit-app-region:no-drag]">
                                    <X className="h-3 w-3" />
                                </Button>
                            </button>
                        ))
                    )}
                </div>
            </PopoverContent>
        </Popover>
    );
}

export default NotificationPopover;
