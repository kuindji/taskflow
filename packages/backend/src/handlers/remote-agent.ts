import { MSG } from "@taskflow/shared";
import type { Router } from "../ws/router";
import type { RemoteAgentService } from "../services/remote-agent-service";

interface RemoteAgentHandlerDeps {
    router: Router;
    remoteAgentService: RemoteAgentService;
}

function registerRemoteAgentHandlers(deps: RemoteAgentHandlerDeps): void {
    const { router, remoteAgentService } = deps;

    router.register(MSG.REMOTE_AGENT_STATUS, async () => {
        return remoteAgentService.getStatus();
    });

    router.register(MSG.REMOTE_AGENT_START, async () => {
        return remoteAgentService.start();
    });

    router.register(MSG.REMOTE_AGENT_STOP, async () => {
        return remoteAgentService.stop();
    });
}

export { registerRemoteAgentHandlers };
