import { BUILTIN_ACTION_IDS } from "../types/builtin-action";
import type {
    BuiltinActionDefault,
    BuiltinActionId,
    BuiltinActionVariable,
} from "../types/builtin-action";

const BUILTIN_ACTION_DEFAULTS: Record<BuiltinActionId, BuiltinActionDefault> = {
    "builtin:task-title": {
        id: "builtin:task-title",
        name: "Generate task title",
        description: "Names a new task from its description when no title is given.",
        mode: "headless",
        prompt: "Generate a concise task title (3-7 words) for this task description. Output ONLY the title, nothing else. No quotes, no punctuation at the end.\n\nDescription: {{description}}",
        sessionType: "claude",
        agentOptions: { type: "claude", model: "haiku" },
        variables: [{ name: "description", description: "The task description" }],
    },
    "builtin:schedule-name": {
        id: "builtin:schedule-name",
        name: "Generate schedule name",
        description: "Names a new schedule from its prompt when no name is given.",
        mode: "headless",
        prompt: "Generate a concise schedule name (3-7 words) for this scheduled task prompt. Output ONLY the name, nothing else. No quotes, no punctuation at the end.\n\nPrompt: {{prompt}}",
        sessionType: "claude",
        agentOptions: { type: "claude", model: "haiku" },
        variables: [{ name: "prompt", description: "The schedule's prompt" }],
    },
    "builtin:commit-message": {
        id: "builtin:commit-message",
        name: "Generate commit message",
        description: "Writes the commit message when the commit dialog's message is left empty.",
        mode: "headless",
        prompt: [
            "Generate a concise git commit message for the following changes.",
            "Output ONLY the commit message — no explanation, no markdown, no quotes.",
            "Use conventional commit format (e.g. feat:, fix:, refactor:).",
            "",
            "{{diff}}",
        ].join("\n"),
        sessionType: "claude",
        variables: [{ name: "diff", description: "The diff of the changes being committed" }],
    },
    "builtin:commit": {
        id: "builtin:commit",
        name: "Commit with agent",
        description: "Starts an agent session from the commit dialog when Use agent is on.",
        mode: "session",
        prompt: "{{instructions}}",
        variables: [
            {
                name: "instructions",
                description:
                    "What to commit, the message hint, and whether to push and open a PR, from the dialog's switches",
            },
        ],
    },
};

function isBuiltinActionId(value: unknown): value is BuiltinActionId {
    return typeof value === "string" && (BUILTIN_ACTION_IDS as readonly string[]).includes(value);
}

/** Whether the built-in may leave its agent unset and follow the machine's default agent. */
function builtinActionFollowsDefaultAgent(id: BuiltinActionId): boolean {
    return BUILTIN_ACTION_DEFAULTS[id].sessionType === undefined;
}

/**
 * Replace each {{name}} with vars[name]. Unknown placeholders stay as written.
 * Substituted text is never scanned again, and `$` patterns are not expanded,
 * because the replacement is computed by a function.
 */
function renderPromptTemplate(template: string, vars: Readonly<Record<string, string>>): string {
    return template.replace(/\{\{(\w+)\}\}/g, (match: string, name: string) =>
        Object.hasOwn(vars, name) ? vars[name] : match,
    );
}

/** Names of required variables whose {{name}} does not appear in the template. */
function missingPromptVariables(
    template: string,
    variables: readonly BuiltinActionVariable[],
): string[] {
    return variables
        .filter((variable) => !template.includes(`{{${variable.name}}}`))
        .map((variable) => variable.name);
}

export {
    BUILTIN_ACTION_DEFAULTS,
    isBuiltinActionId,
    builtinActionFollowsDefaultAgent,
    renderPromptTemplate,
    missingPromptVariables,
};
