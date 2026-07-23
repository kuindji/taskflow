import type { AttributeLayer } from "../types/attribute";
import { resolveAttributes } from "./attributes";
import { isAbsolutePath, joinRelative } from "./markdown/paths";

/**
 * The one attribute that declares a wiki. Attribute names are user-authored
 * free text, so this is matched exactly — no case folding, no aliases.
 */
const WIKI_ATTRIBUTE_NAME = "wiki";

interface ResolveWikiRootArgs {
    layers: AttributeLayer[];
    workingDir: string | null;
}

/**
 * Resolve the wiki root for a workspace, honouring the normal attribute
 * layering so a task shadows its parent shadows its project. A relative value
 * resolves against `workingDir`, which for a task in a worktree is that
 * worktree — the correct behaviour when a task is editing docs.
 *
 * Returns null when there is no `wiki` attribute, no working dir, or an empty
 * value. Whether the path actually exists is not decided here.
 */
function resolveWikiRoot({ layers, workingDir }: ResolveWikiRootArgs): string | null {
    const resolved = resolveAttributes(layers);
    const attribute = resolved.find((entry) => entry.name === WIKI_ATTRIBUTE_NAME);
    const value = attribute?.value.trim() ?? "";
    if (value === "") return null;

    const withoutTrailingSlash = value.replace(/[/\\]+$/, "");
    if (withoutTrailingSlash === "") return null;

    if (isAbsolutePath(withoutTrailingSlash)) {
        return joinRelative("", withoutTrailingSlash);
    }
    if (workingDir === null) return null;
    return joinRelative(workingDir, withoutTrailingSlash);
}

export { WIKI_ATTRIBUTE_NAME, resolveWikiRoot };
