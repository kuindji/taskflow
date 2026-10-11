import type { ApiRouter } from "../router";
import type { DevServerListResponse } from "@taskflow/shared";
import type { DevServerService } from "../../services/dev-server-service";
import { DevServerInputError } from "../../services/dev-server-service";
import { jsonResponse, errorResponse } from "./response-helpers";

interface DevServerRouteDeps {
    apiRouter: ApiRouter;
    devServerService: DevServerService;
}

const MISSING_PROJECT = "Missing required header: x-taskflow-project-id";
const NOT_FOUND = "Dev server not found";
const BAD_PID = "Field 'pid' must be a positive integer";

function bodyField(body: unknown, name: string): unknown {
    if (typeof body !== "object" || body === null) return undefined;
    return (body as Record<string, unknown>)[name];
}

/** `?pid=` as a positive integer, or null. Digits only: "1.5", "-5" and "1e3" are refused. */
function queryPid(raw: string | null): number | null {
    if (raw === null || !/^\d+$/.test(raw)) return null;
    const pid = Number(raw);
    return Number.isSafeInteger(pid) && pid > 0 ? pid : null;
}

function registerDevServerRoutes(deps: DevServerRouteDeps): void {
    const { apiRouter, devServerService } = deps;

    apiRouter.register("POST", "/api/dev-servers", async (req) => {
        const projectId = req.headers.get("x-taskflow-project-id");
        if (!projectId) return errorResponse(MISSING_PROJECT, 400);
        const taskId = req.headers.get("x-taskflow-task-id") || undefined;
        const sessionId = req.headers.get("x-taskflow-session-id") || undefined;

        let body: unknown;
        try {
            body = await req.json();
        } catch {
            return errorResponse("Invalid JSON body", 400);
        }

        // Wrong JSON types become values the service refuses with its own message.
        const pid = bodyField(body, "pid");
        const label = bodyField(body, "label");
        try {
            const devServer = await devServerService.add({
                pid: typeof pid === "number" ? pid : Number.NaN,
                label: typeof label === "string" ? label : "",
                projectId,
                ...(taskId ? { taskId } : {}),
                ...(sessionId ? { sessionId } : {}),
            });
            return jsonResponse(devServer, 201);
        } catch (error) {
            if (error instanceof DevServerInputError) return errorResponse(error.message, 400);
            throw error;
        }
    });

    apiRouter.register("GET", "/api/dev-servers", async (req) => {
        const all = new URL(req.url).searchParams.get("all") === "1";
        const projectId = req.headers.get("x-taskflow-project-id");
        if (!all && !projectId) return errorResponse(MISSING_PROJECT, 400);
        const taskId = req.headers.get("x-taskflow-task-id") || undefined;

        const devServers = await devServerService.list();
        const response: DevServerListResponse = {
            devServers: all
                ? devServers
                : devServers.filter((server) =>
                      taskId
                          ? server.taskId === taskId
                          : server.projectId === projectId && !server.taskId,
                  ),
        };
        return jsonResponse(response);
    });

    apiRouter.register("DELETE", "/api/dev-servers/:id", async (_req, params) => {
        const removed = await devServerService.remove(params.id);
        if (!removed) return errorResponse(NOT_FOUND, 404);
        return jsonResponse({ success: true });
    });

    apiRouter.register("DELETE", "/api/dev-servers", async (req) => {
        const pid = queryPid(new URL(req.url).searchParams.get("pid"));
        if (pid === null) return errorResponse(BAD_PID, 400);
        const removed = await devServerService.removeByPid(pid);
        if (!removed) return errorResponse(NOT_FOUND, 404);
        return jsonResponse({ success: true });
    });
}

export { registerDevServerRoutes };
