import { MSG, type BrowserTabClosePayload, type BrowserTabOpenPayload } from "@taskflow/shared";
import type { Router } from "../ws/router";
import type { BrowserTabService } from "../services/browser-tab-service";
import { BrowserTabNotFoundError } from "../services/browser-tab-errors";

interface BrowserHandlerDeps {
    router: Router;
    browserTabService: BrowserTabService;
}

function registerBrowserHandlers({ router, browserTabService }: BrowserHandlerDeps): void {
    router.register(MSG.BROWSER_TABS_LIST, async () => browserTabService.list());
    router.register(MSG.BROWSER_TAB_OPEN, async (payload) =>
        browserTabService.open(payload as BrowserTabOpenPayload),
    );
    router.register(MSG.BROWSER_TAB_CLOSE, async (payload) => {
        const { id } = payload as BrowserTabClosePayload;
        if (!(await browserTabService.close(id)))
            throw new BrowserTabNotFoundError("Browser tab not found");
        return { success: true };
    });
}

export { registerBrowserHandlers };
