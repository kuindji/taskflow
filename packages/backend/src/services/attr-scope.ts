// Pure precedence logic for resolving the task/project scope of `taskflow-cli attr` commands.
// Kept free of process.exit / stderr side effects so it can be unit tested directly —
// see cli-flags.ts for the sibling pattern this follows.

interface AttrScope {
    collection: "tasks" | "projects";
    ownerId: string;
}

type AttrScopeErrorKind = "both-flags" | "no-scope";

type AttrScopeResult = { ok: true; scope: AttrScope } | { ok: false; error: AttrScopeErrorKind };

function decideAttrScope(
    taskFlag: string,
    projectFlag: string,
    fallbackTaskId: string,
    fallbackProjectId: string,
): AttrScopeResult {
    if (taskFlag && projectFlag) {
        return { ok: false, error: "both-flags" };
    }
    if (taskFlag) return { ok: true, scope: { collection: "tasks", ownerId: taskFlag } };
    if (projectFlag) return { ok: true, scope: { collection: "projects", ownerId: projectFlag } };
    if (fallbackTaskId) return { ok: true, scope: { collection: "tasks", ownerId: fallbackTaskId } };
    if (fallbackProjectId) {
        return { ok: true, scope: { collection: "projects", ownerId: fallbackProjectId } };
    }
    return { ok: false, error: "no-scope" };
}

export { decideAttrScope };
export type { AttrScope, AttrScopeErrorKind, AttrScopeResult };
