import { renderPromptTemplate } from "@taskflow/shared";
import type {
    BuiltinActionVariableValues,
    HeadlessBuiltinActionId,
    Project,
} from "@taskflow/shared";
import type { BuiltinActions } from "./builtin-actions";
import type { SettingsStore } from "./settings-store";
import { headlessAgentEnv } from "./agent-accounts";
import { runHeadlessAgent } from "./headless-agent";

interface BuiltinRunContext {
    cwd?: string;
    /** The project the run belongs to, for its account override; null when none. */
    project: Project | null;
}

interface BuiltinActionRunner {
    runHeadless<K extends HeadlessBuiltinActionId>(
        id: K,
        vars: BuiltinActionVariableValues[K],
        context: BuiltinRunContext,
    ): Promise<string>;
}

interface BuiltinActionRunnerDeps {
    builtinActions: Pick<BuiltinActions, "get">;
    settingsStore: SettingsStore;
}

function createBuiltinActionRunner({
    builtinActions,
    settingsStore,
}: BuiltinActionRunnerDeps): BuiltinActionRunner {
    return {
        async runHeadless(id, vars, context) {
            try {
                const action = await builtinActions.get(id);
                // Saving validates that headless built-ins always name an agent.
                if (!action.sessionType) throw new Error(`Built-in action ${id} has no agent`);
                const env = headlessAgentEnv(
                    action.sessionType,
                    action.agentOptions,
                    await settingsStore.get(),
                    context.project,
                );
                return await runHeadlessAgent({
                    type: action.sessionType,
                    options: action.agentOptions,
                    prompt: renderPromptTemplate(action.prompt, vars),
                    cwd: context.cwd,
                    env,
                });
            } catch (error) {
                // Callers fall back silently; leave a trace for "why is my title wrong".
                console.warn(
                    `Built-in action ${id} failed: ${error instanceof Error ? error.message : String(error)}`,
                );
                throw error;
            }
        },
    };
}

export { createBuiltinActionRunner };
export type { BuiltinActionRunner };
