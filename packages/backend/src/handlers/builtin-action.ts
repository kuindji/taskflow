import { MSG, isBuiltinActionId } from "@taskflow/shared";
import type { Router } from "../ws/router";
import type { BuiltinActions } from "../services/builtin-actions";

interface BuiltinActionHandlerDeps {
    router: Router;
    builtinActions: BuiltinActions;
}

function registerBuiltinActionHandlers({ router, builtinActions }: BuiltinActionHandlerDeps): void {
    router.register(MSG.BUILTIN_ACTIONS_LIST, async () => ({
        actions: await builtinActions.list(),
    }));

    // The payload is validated inside save(); it is unknown until then.
    router.register(MSG.BUILTIN_ACTION_SAVE, async (payload) => builtinActions.save(payload));

    router.register(MSG.BUILTIN_ACTION_RESET, async (payload) => {
        const id =
            typeof payload === "object" && payload !== null && "id" in payload
                ? payload.id
                : undefined;
        if (!isBuiltinActionId(id)) throw new Error(`Unknown built-in action "${String(id)}"`);
        return builtinActions.reset(id);
    });
}

export { registerBuiltinActionHandlers };
