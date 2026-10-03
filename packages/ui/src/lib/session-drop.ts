import type { SessionMovePayload } from "@taskflow/shared";
import type { Tab } from "@/stores/session-helpers";
import { baseWorkspaceKey } from "@/stores/session-helpers";

/** A sidebar element a session tab can be dropped on (`data-session-drop`). */
interface SessionDropTarget {
    kind: "task" | "project";
    id: string;
    backendId: string;
    /** The target's workspace key: `task:<id>` or `project:<id>`. */
    key: string;
}

function readTarget(host: HTMLElement): SessionDropTarget | null {
    const value = host.dataset.sessionDrop ?? "";
    const backendId = host.dataset.sessionDropBackend ?? "";
    const separator = value.indexOf(":");
    const kind = value.slice(0, separator);
    const id = value.slice(separator + 1);
    if (separator < 0 || !id || !backendId) return null;
    if (kind !== "task" && kind !== "project") return null;
    return { kind, id, backendId, key: value };
}

/** `elements` is the stack under the pointer (document.elementsFromPoint), topmost first. */
function resolveSessionDrop(elements: Element[]): {
    inZone: boolean;
    target: SessionDropTarget | null;
} {
    const host = elements
        .map((element) => element.closest<HTMLElement>("[data-session-drop]"))
        .find((found) => found !== null);
    return {
        inZone: elements.some((element) => element.closest("[data-session-drop-zone]") !== null),
        target: host ? readTarget(host) : null,
    };
}

function isValidSessionDrop(args: {
    tab: Tab | undefined;
    sourceWorkspaceKey: string;
    sourceBackendId: string | null;
    target: SessionDropTarget;
}): boolean {
    const { tab, sourceWorkspaceKey, sourceBackendId, target } = args;
    return (
        tab?.movable === true &&
        sourceBackendId !== null &&
        target.backendId === sourceBackendId &&
        target.key !== baseWorkspaceKey(sourceWorkspaceKey)
    );
}

function sessionMovePayload(sessionId: string, target: SessionDropTarget): SessionMovePayload {
    return target.kind === "task"
        ? { sessionId, taskId: target.id }
        : { sessionId, projectId: target.id };
}

export { resolveSessionDrop, isValidSessionDrop, sessionMovePayload };
export type { SessionDropTarget };
