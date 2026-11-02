import { MSG } from "@taskflow/shared";
import type { EditorInfo, SystemInfo } from "@taskflow/shared";
import type { Router } from "../ws/router";

interface SystemHandlerDeps {
    router: Router;
    editors: EditorInfo[];
    homedir: string;
    schedulerEnabled: boolean;
    hostname: string;
    protocolVersion: number;
    backendUid: string;
    os: string;
}

export function registerSystemHandlers(deps: SystemHandlerDeps): void {
    const {
        router,
        editors,
        homedir,
        schedulerEnabled,
        hostname,
        protocolVersion,
        backendUid,
        os,
    } = deps;

    router.register(MSG.SYSTEM_INFO, async (): Promise<SystemInfo> => {
        return { editors, homedir, schedulerEnabled, hostname, protocolVersion, backendUid, os };
    });
}
