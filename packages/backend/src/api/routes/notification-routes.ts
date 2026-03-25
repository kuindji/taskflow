import type { ApiRouter } from "../router";
import type { NotificationStore } from "../../services/notification-store";
import type { NotificationDeletedEvent, WsEvent } from "@taskflow/shared";
import { MSG } from "@taskflow/shared";
import { jsonResponse, errorResponse } from "./response-helpers";

interface NotificationRouteDeps {
    apiRouter: ApiRouter;
    notificationStore: NotificationStore;
    broadcast: (event: WsEvent) => void;
}

function registerNotificationRoutes(deps: NotificationRouteDeps): void {
    const { apiRouter, notificationStore, broadcast } = deps;

    apiRouter.register("GET", "/api/notifications", async () => {
        const notifications = await notificationStore.list();
        return jsonResponse({ notifications });
    });

    apiRouter.register("POST", "/api/notifications", async (req) => {
        const projectId = req.headers.get("x-taskflow-project-id");
        const sessionId = req.headers.get("x-taskflow-session-id");
        const taskId = req.headers.get("x-taskflow-task-id") || undefined;

        if (!projectId || !sessionId) {
            return errorResponse(
                "Missing required headers: x-taskflow-project-id, x-taskflow-session-id",
                400,
            );
        }

        let body: { message?: unknown };
        try {
            body = (await req.json()) as { message?: unknown };
        } catch {
            return errorResponse("Invalid JSON body", 400);
        }

        if (typeof body.message !== "string" || !body.message.trim()) {
            return errorResponse("Field 'message' is required and must be a non-empty string", 400);
        }

        const notification = await notificationStore.create(
            projectId,
            sessionId,
            body.message.trim(),
            taskId,
        );
        broadcast({ type: MSG.NOTIFICATION_CREATED, payload: { notification } });
        return jsonResponse(notification, 201);
    });

    apiRouter.register("PATCH", "/api/notifications/:id", async (_req, params) => {
        const notification = await notificationStore.markAsRead(params.id);
        if (!notification) return errorResponse("Notification not found", 404);
        broadcast({ type: MSG.NOTIFICATION_UPDATED, payload: { notification } });
        return jsonResponse(notification);
    });

    apiRouter.register("DELETE", "/api/notifications/:id", async (_req, params) => {
        const deleted = await notificationStore.delete(params.id);
        if (!deleted) return errorResponse("Notification not found", 404);
        const event: NotificationDeletedEvent = { id: params.id };
        broadcast({ type: MSG.NOTIFICATION_DELETED, payload: event });
        return jsonResponse({ success: true });
    });

    apiRouter.register("DELETE", "/api/notifications", async () => {
        await notificationStore.deleteAll();
        const event: NotificationDeletedEvent = { all: true };
        broadcast({ type: MSG.NOTIFICATION_DELETED, payload: event });
        return jsonResponse({ success: true });
    });
}

export { registerNotificationRoutes };
export type { NotificationRouteDeps };
