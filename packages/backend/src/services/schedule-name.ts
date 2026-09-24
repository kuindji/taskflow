import type { BuiltinActionRunner } from "./builtin-action-runner";

interface ScheduleNameGeneratorDeps {
    builtinActionRunner: BuiltinActionRunner;
}

function createScheduleNameGenerator({ builtinActionRunner }: ScheduleNameGeneratorDeps) {
    return async (prompt: string): Promise<string> => {
        try {
            const output = await builtinActionRunner.runHeadless(
                "builtin:schedule-name",
                { prompt },
                { project: null },
            );
            const name = output.replace(/^["']|["']$/g, "");
            if (name) return name;
        } catch {
            // Fall through to fallback
        }
        return prompt.slice(0, 50).trim() || "Unnamed schedule";
    };
}

export { createScheduleNameGenerator };
