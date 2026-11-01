import type { ScrollBoxRenderable } from "@opentui/core";

/**
 * Keeps a list's selected row inside the scroll box. Rows only have positions
 * after layout, so the returned callback marks the row and the scroll happens in
 * the next render pass; scrolling requests the frame that draws it.
 */
function followSelection(list: ScrollBoxRenderable, rowId: string): () => void {
    let pending = false;
    list.renderBefore = () => {
        if (!pending) return;
        pending = false;
        list.scrollChildIntoView(rowId);
    };
    return () => {
        pending = true;
    };
}

export { followSelection };
