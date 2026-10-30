import type { BrowserHostEvent, BrowserHostHeartbeat, BrowserTabScope } from "@taskflow/shared";
import type { ApiRouter } from "../router";
import type { BrowserTabService } from "../../services/browser-tab-service";
import type { CdpGateway } from "../../services/cdp/cdp-gateway";
import {
    BrowserHostUnavailableError,
    BrowserTabInputError,
    BrowserTabNotFoundError,
} from "../../services/browser-tab-errors";
import { errorResponse, jsonResponse } from "./response-helpers";

interface BrowserRouteDeps {
    apiRouter: ApiRouter;
    browserTabService: BrowserTabService;
    cdpGateway: CdpGateway;
}

function resolveScope(req: Request, kind: unknown): BrowserTabScope {
    const taskId = req.headers.get("x-taskflow-task-id");
    const projectId = req.headers.get("x-taskflow-project-id");
    if (kind === undefined || kind === null) {
        if (taskId) return { kind: "task", taskId };
        if (projectId) return { kind: "project", projectId };
        return { kind: "master" };
    }
    if (kind === "master") return { kind: "master" };
    if (kind === "task" && taskId) return { kind: "task", taskId };
    if (kind === "project" && projectId) return { kind: "project", projectId };
    throw new BrowserTabInputError("Missing scope: no task, project or master context");
}

async function readBody(req: Request): Promise<unknown> {
    try {
        return await req.json();
    } catch {
        throw new BrowserTabInputError("Invalid JSON body");
    }
}

function endpoint(req: Request, id: string): string {
    const url = new URL(req.url);
    return `${url.protocol}//${req.headers.get("host") || url.host}/cdp/${id}`;
}

function registerBrowserRoutes({
    apiRouter,
    browserTabService,
    cdpGateway,
}: BrowserRouteDeps): void {
    function register(method: string, path: string, handler: Parameters<ApiRouter["register"]>[2]) {
        apiRouter.register(method, path, async (req, params) => {
            try {
                return await handler(req, params);
            } catch (error) {
                if (error instanceof BrowserTabInputError) return errorResponse(error.message, 400);
                if (error instanceof BrowserTabNotFoundError)
                    return errorResponse(error.message, 404);
                if (error instanceof BrowserHostUnavailableError)
                    return errorResponse(error.message, 503);
                throw error;
            }
        });
    }

    for (const path of ["/cdp/:tabId/json/version", "/cdp/:tabId/json/version/"]) {
        register("GET", path, async (req, params) =>
            jsonResponse(
                await cdpGateway.versionJson(
                    params.tabId,
                    req.headers.get("host") || new URL(req.url).host,
                ),
            ),
        );
    }
    for (const path of ["/cdp/:tabId/json/list", "/cdp/:tabId/json"]) {
        register("GET", path, async (req, params) =>
            jsonResponse(
                await cdpGateway.listJson(
                    params.tabId,
                    req.headers.get("host") || new URL(req.url).host,
                ),
            ),
        );
    }

    register("POST", "/api/browser/tabs", async (req) => {
        const raw = await readBody(req);
        const body =
            typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
        const tab = await browserTabService.open({
            scope: resolveScope(req, body.scope),
            url: typeof body.url === "string" ? body.url : "",
            ...(typeof body.label === "string" ? { label: body.label } : {}),
        });
        return jsonResponse({ tab, endpoint: endpoint(req, tab.id) }, 201);
    });
    register("GET", "/api/browser/tabs", async (req) => {
        const scope = resolveScope(req, new URL(req.url).searchParams.get("scope"));
        const result = browserTabService.list({ scope });
        return jsonResponse({
            ...result,
            tabs: result.tabs.map((tab) => ({ ...tab, endpoint: endpoint(req, tab.id) })),
        });
    });
    register("DELETE", "/api/browser/tabs/:id", async (_req, params) => {
        if (!(await browserTabService.close(params.id)))
            throw new BrowserTabNotFoundError("Browser tab not found");
        return jsonResponse({ success: true });
    });
    register("PUT", "/api/browser/host", async (req) => {
        browserTabService.hostHeartbeat((await readBody(req)) as BrowserHostHeartbeat);
        return jsonResponse({ ok: true });
    });
    register("POST", "/api/browser/host/events", async (req) => {
        await browserTabService.hostEvent((await readBody(req)) as BrowserHostEvent);
        return jsonResponse({ ok: true });
    });
}

export { registerBrowserRoutes };
