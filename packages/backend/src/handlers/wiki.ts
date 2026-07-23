import { MSG } from "@taskflow/shared";
import type { WikiIndexPayload } from "@taskflow/shared";
import type { Router } from "../ws/router";
import type { TaskStore } from "../services/task-store";
import type { WikiIndexService } from "../services/wiki-index";
import { assertWorkspacePath } from "../utils/path-validation";

interface WikiHandlerDeps {
    router: Router;
    taskStore: TaskStore;
    wikiIndex: WikiIndexService;
}

export function registerWikiHandlers({ router, taskStore, wikiIndex }: WikiHandlerDeps): void {
    router.register(MSG.WIKI_INDEX, async (payload) => {
        const { root } = payload as WikiIndexPayload;
        // The root arrives from the renderer, so it is re-validated here just
        // like every other path the renderer names.
        const workspaceRoot = await assertWorkspacePath(taskStore, root);
        return wikiIndex.get(workspaceRoot);
    });
}
