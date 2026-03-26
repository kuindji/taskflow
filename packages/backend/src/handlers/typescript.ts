import { MSG } from "@taskflow/shared";
import type { TsResolveTsconfigPayload, TsResolveImportPayload } from "@taskflow/shared";
import type { Router } from "../ws/router";
import type { TaskStore } from "../services/task-store";
import { assertWorkspacePath } from "../utils/path-validation";
import { resolveTsconfig, resolveImport } from "../services/typescript-resolver";

interface TypeScriptHandlerDeps {
    router: Router;
    taskStore: TaskStore;
}

export function registerTypeScriptHandlers(deps: TypeScriptHandlerDeps): void {
    const { router, taskStore } = deps;

    router.register(MSG.TS_RESOLVE_TSCONFIG, async (payload) => {
        const { filePath } = payload as TsResolveTsconfigPayload;
        await assertWorkspacePath(taskStore, filePath);
        const result = await resolveTsconfig(filePath);
        return result;
    });

    router.register(MSG.TS_RESOLVE_IMPORT, async (payload) => {
        const { sourceFilePath, importSpecifier } = payload as TsResolveImportPayload;
        await assertWorkspacePath(taskStore, sourceFilePath);
        const resolvedPath = await resolveImport(sourceFilePath, importSpecifier);
        return { resolvedPath };
    });
}
