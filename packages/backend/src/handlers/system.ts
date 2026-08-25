import { MSG } from "@taskflow/shared";
import type { EditorInfo, SystemInfo } from "@taskflow/shared";
import type { Router } from "../ws/router";

interface SystemHandlerDeps {
    router: Router;
    editors: EditorInfo[];
    homedir: string;
    schedulerEnabled: boolean;
}

export function registerSystemHandlers(deps: SystemHandlerDeps): void {
    const { router, editors, homedir, schedulerEnabled } = deps;

    router.register(MSG.SYSTEM_INFO, async (): Promise<SystemInfo> => {
        return { editors, homedir, schedulerEnabled };
    });
}
