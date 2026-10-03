import { useMemo } from "react";
import type { UniqueIdentifier } from "@dnd-kit/core";
import { MSG } from "@taskflow/shared";
import type { SessionMovePayload } from "@taskflow/shared";
import { sendRequest } from "@/lib/connection-registry";
import { isValidSessionDrop, resolveSessionDrop, sessionMovePayload } from "@/lib/session-drop";
import type { SessionDropTarget } from "@/lib/session-drop";
import { workspaceBackendId } from "@/hooks/useActiveWorkspace";
import { alert } from "@/stores/dialog-store";
import { findSessionTab } from "@/stores/session-store";
import { useUIStore } from "@/stores/ui-store";

/** The part of dnd-kit's drag events this hook reads. */
interface TabDragEvent {
    active: { id: UniqueIdentifier };
    activatorEvent: Event;
}

interface SessionMoveDragDeps {
    send(backendId: string, payload: SessionMovePayload): Promise<unknown>;
    report(message: string): void;
    /** Every element under a point, topmost first. */
    elementsAt(x: number, y: number): Element[];
    /** Where pointer moves are observed for the length of a drag. */
    pointerEvents: EventTarget;
}

const browserDeps: SessionMoveDragDeps = {
    send: (backendId, payload) => sendRequest(backendId, MSG.SESSION_MOVE, payload),
    report: (message) => void alert({ title: "Couldn't move session", description: message }),
    elementsAt: (x, y) => document.elementsFromPoint(x, y),
    pointerEvents: window,
};

/**
 * Drag a session tab onto a sidebar task card or project row. The sidebar
 * lives in another dnd-kit context, so it is hit-tested rather than
 * registered as a droppable, at the real pointer position: dnd-kit's delta is
 * scroll-adjusted, and its DragOverlay sits under the cursor.
 */
function createSessionMoveDrag(deps: SessionMoveDragDeps = browserDeps) {
    let pointer: { x: number; y: number } | null = null;
    const track = (event: Event) => {
        if (event instanceof MouseEvent) pointer = { x: event.clientX, y: event.clientY };
    };

    function stopTracking(): void {
        deps.pointerEvents.removeEventListener("pointermove", track, true);
        useUIStore.getState().setSessionDropTarget(null);
    }

    /** Where the pointer is now: outside the sidebar, or in it with a valid target or none. */
    function hitTest(
        event: TabDragEvent,
    ): { inZone: false } | { inZone: true; target: SessionDropTarget | null } {
        if (!pointer) return { inZone: false };
        const { inZone, target } = resolveSessionDrop(deps.elementsAt(pointer.x, pointer.y));
        if (!inZone) return { inZone: false };
        const found = findSessionTab(String(event.active.id));
        const valid =
            found !== null &&
            target !== null &&
            isValidSessionDrop({
                tab: found.tab,
                sourceWorkspaceKey: found.workspaceKey,
                sourceBackendId: workspaceBackendId(found.workspaceKey),
                target,
            });
        return { inZone: true, target: valid ? target : null };
    }

    function onDragStart(event: TabDragEvent): void {
        const start = event.activatorEvent;
        pointer = start instanceof MouseEvent ? { x: start.clientX, y: start.clientY } : null;
        deps.pointerEvents.addEventListener("pointermove", track, true);
    }

    function onDragMove(event: TabDragEvent): void {
        const hit = hitTest(event);
        useUIStore.getState().setSessionDropTarget(hit.inZone ? hit.target : null);
    }

    function onDragEnd(event: TabDragEvent): boolean {
        const hit = hitTest(event);
        stopTracking();
        if (!hit.inZone) return false;
        const sessionId = findSessionTab(String(event.active.id))?.tab.sessionId;
        if (hit.target && sessionId) {
            deps.send(hit.target.backendId, sessionMovePayload(sessionId, hit.target)).catch(
                (error: unknown) => {
                    deps.report(error instanceof Error ? error.message : String(error));
                },
            );
        }
        return true;
    }

    function onDragCancel(): void {
        stopTracking();
    }

    return { onDragStart, onDragMove, onDragEnd, onDragCancel };
}

function useSessionMoveDrag() {
    return useMemo(() => createSessionMoveDrag(), []);
}

export { useSessionMoveDrag, createSessionMoveDrag };
export type { TabDragEvent };
