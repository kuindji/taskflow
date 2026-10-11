import { MSG } from "@taskflow/shared";
import type { DevServerListResponse, DevServerStopResult } from "@taskflow/shared";
import type { Router } from "../ws/router";
import type { DevServerService } from "../services/dev-server-service";

interface DevServerHandlerDeps {
    router: Router;
    devServerService: DevServerService;
}

function registerDevServerHandlers({ router, devServerService }: DevServerHandlerDeps): void {
    router.register(
        MSG.DEV_SERVER_LIST,
        async (): Promise<DevServerListResponse> => ({
            devServers: await devServerService.list(),
        }),
    );

    router.register(MSG.DEV_SERVER_STOP, async (payload): Promise<DevServerStopResult> => {
        const id =
            typeof payload === "object" && payload !== null && "id" in payload
                ? payload.id
                : undefined;
        if (typeof id !== "string" || !id) throw new Error("Field 'id' is required");
        return devServerService.stop(id);
    });
}

export { registerDevServerHandlers };
