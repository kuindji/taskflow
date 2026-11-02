import type { FileChangeEvent } from "@taskflow/shared";

/**
 * Whether a FILE_CHANGED event may have changed the file at `filePath`. The
 * watcher collapses a burst (a checkout, a large agent edit) into one
 * recursive event on an ancestor directory, so an exact-path match alone
 * misses those. A delete has no new text to show.
 */
export function fileChangeCovers(event: FileChangeEvent, filePath: string): boolean {
    if (event.type === "delete") return false;
    return event.recursive
        ? filePath === event.path || filePath.startsWith(event.path + "/")
        : event.path === filePath;
}
