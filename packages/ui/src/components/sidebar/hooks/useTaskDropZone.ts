import { useCallback, useRef, useState } from "react";
import type { DragEvent } from "react";
import { acceptsDrop, parseDroppedTask } from "@/lib/dropped-task";
import { useTaskCreationStore } from "@/stores/task-creation-store";

type DragHandler = (event: DragEvent<HTMLElement>) => void;

interface DropZone {
    isOver: boolean;
    handlers: {
        onDragEnter: DragHandler;
        onDragOver: DragHandler;
        onDragLeave: DragHandler;
        onDrop: DragHandler;
    };
}

/**
 * Makes an element accept text dragged in from another application and turn it
 * into a new task.
 *
 * `projectId` pins the project the dialog opens on; without one the dialog falls
 * back to its usual precedence.
 *
 * Native drag events, not dnd-kit: the sidebar's project reordering runs on
 * dnd-kit's `PointerSensor`, which listens to pointer events, so the two never
 * see each other's events.
 *
 * Every handler claims the event it acts on. `App.tsx` installs a document-level
 * `dragover`/`drop` guard that cancels the browser's default file-drop
 * navigation, and opting out of it is what `preventDefault` here is for.
 * `stopPropagation` is what makes nesting work: a zone on a project row keeps
 * the event from the sidebar-wide zone outside it, so the inner one wins and —
 * because the outer zone then sees the leave without the matching enter — the
 * outer highlight goes out as the inner one comes on.
 */
function useTaskDropZone(projectId?: string): DropZone {
    const [isOver, setIsOver] = useState(false);
    // Depth, not a boolean: moving the pointer between an element's children
    // fires leave/enter pairs that would otherwise flicker the highlight off.
    const depth = useRef(0);

    const onDragEnter = useCallback((event: DragEvent<HTMLElement>) => {
        if (!acceptsDrop(event.dataTransfer.types)) return;
        event.preventDefault();
        event.stopPropagation();
        depth.current += 1;
        setIsOver(true);
    }, []);

    const onDragOver = useCallback((event: DragEvent<HTMLElement>) => {
        if (!acceptsDrop(event.dataTransfer.types)) return;
        event.preventDefault();
        event.stopPropagation();
        event.dataTransfer.dropEffect = "copy";
    }, []);

    const onDragLeave = useCallback((event: DragEvent<HTMLElement>) => {
        if (!acceptsDrop(event.dataTransfer.types)) return;
        event.stopPropagation();
        depth.current = Math.max(0, depth.current - 1);
        if (depth.current === 0) setIsOver(false);
    }, []);

    const onDrop = useCallback(
        (event: DragEvent<HTMLElement>) => {
            if (!acceptsDrop(event.dataTransfer.types)) return;
            event.preventDefault();
            event.stopPropagation();
            depth.current = 0;
            setIsOver(false);
            const dropped = parseDroppedTask(event.dataTransfer);
            if (!dropped) return;
            useTaskCreationStore.getState().requestNewTaskWithPrefill(dropped, projectId);
        },
        [projectId],
    );

    return { isOver, handlers: { onDragEnter, onDragOver, onDragLeave, onDrop } };
}

export { useTaskDropZone };
