import type { ApiRouter } from "../router";
import type { SettingsStore } from "../../services/settings-store";
import type { TrayStateTracker } from "../../services/tray-state-tracker";
import type { RemoteAgentService } from "../../services/remote-agent-service";
import type {
    AgentAvailability,
    EditorInfo,
    RuntimeInfo,
    ShellInfo,
    SettingsUpdatePayload,
} from "@taskflow/shared";
import { jsonResponse, errorResponse } from "./response-helpers";
import { getResolvedCliHelp } from "../../services/internal-agent-skill";

interface SettingsRouteDeps {
    apiRouter: ApiRouter;
    settingsStore: SettingsStore;
    trayStateTracker: TrayStateTracker;
    remoteAgentService: RemoteAgentService;
    agents: AgentAvailability[];
    shells: ShellInfo[];
    systemShellPath: string | null;
    runtimes: RuntimeInfo[];
    editors: EditorInfo[];
}

function registerSettingsRoutes(deps: SettingsRouteDeps): void {
    const {
        apiRouter,
        settingsStore,
        trayStateTracker,
        remoteAgentService,
        agents,
        shells,
        systemShellPath,
        runtimes,
        editors,
    } = deps;

    apiRouter.register("GET", "/api/settings", async () => {
        return jsonResponse(await settingsStore.get());
    });

    apiRouter.register("GET", "/api/app-name", async () => {
        const name = await remoteAgentService.getAppName();
        return jsonResponse({ name });
    });

    apiRouter.register("GET", "/api/cli-help", async () => {
        return new Response(getResolvedCliHelp(), {
            headers: { "Content-Type": "text/plain; charset=utf-8" },
        });
    });

    apiRouter.register("GET", "/api/tray-state", async () => {
        return jsonResponse({ status: trayStateTracker.getAggregateState() });
    });

    apiRouter.register("PATCH", "/api/settings", async (req) => {
        let body: SettingsUpdatePayload;
        try {
            body = (await req.json()) as SettingsUpdatePayload;
        } catch {
            return errorResponse("Invalid JSON body", 400);
        }
        return jsonResponse(await settingsStore.update(body));
    });

    apiRouter.register("GET", "/api/agents", async () => {
        return jsonResponse({ agents });
    });

    // ── System info ────────────────────────────────────────────────

    apiRouter.register("GET", "/api/system/info", async () => {
        return jsonResponse({ editors });
    });

    apiRouter.register("GET", "/api/shells", async () => {
        return jsonResponse({ shells, systemShellPath });
    });

    apiRouter.register("GET", "/api/runtimes", async () => {
        return jsonResponse({ runtimes });
    });
}

export { registerSettingsRoutes };
export type { SettingsRouteDeps };
