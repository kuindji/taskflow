/** A GFM task marker at the start of a list item, allowing blockquote prefixes. */
const TASK_ITEM = /^(\s*(?:>\s*)*(?:[-*+]|\d+[.)])\s+\[)([ xX])(\])/;

/**
 * Flip the checkbox on a 1-based source line. The line comes from the mdast
 * position stamped onto the rendered `<li>`, so only lines the renderer
 * actually turned into a checkbox can ever be passed here. Every other byte of
 * the document is preserved.
 */
function toggleTaskListItemAtLine(source: string, line: number): string {
    const lines = source.split("\n");
    const index = line - 1;
    if (index < 0 || index >= lines.length) return source;

    const text = lines[index];
    const item = TASK_ITEM.exec(text);
    if (!item) return source;

    const next = item[2] === " " ? "x" : " ";
    lines[index] = `${item[1]}${next}${text.slice(item[1].length + 1)}`;
    return lines.join("\n");
}

/**
 * Find, in `current`, the line that was line `line` in `snapshot`.
 *
 * A checkbox click carries a line number read off the document the pane had
 * rendered, but the bytes on disk may have moved on since — another pane, an
 * agent, or an external editor may have written in between. Re-applying "line
 * N" blindly to the new bytes could flip a different item, so the item is
 * re-located by its exact source text instead:
 *
 * - the line must still be a task item, and
 * - its exact text must occur once and only once in both documents.
 *
 * Insisting on a unique match is what makes this safe: an ordinal among
 * identical twins survives an insertion above but not a reordering, and there
 * is no way to tell those apart from the bytes alone. Uniqueness has no such
 * blind spot, and duplicate task lines are rare enough that giving up on them
 * costs a click, not correctness.
 *
 * `null` means "give up" — the item was edited, checked by someone else, or is
 * ambiguous. Callers drop the click and re-render from disk rather than guess.
 */
function relocateTaskLine(snapshot: string, current: string, line: number): number | null {
    const snapshotLines = snapshot.split("\n");
    const index = line - 1;
    if (index < 0 || index >= snapshotLines.length) return null;

    const text = snapshotLines[index];
    if (!TASK_ITEM.test(text)) return null;
    if (snapshotLines.filter((l) => l === text).length !== 1) return null;

    const currentLines = current.split("\n");
    const matches = currentLines.filter((l) => l === text).length;
    if (matches !== 1) return null;

    return currentLines.indexOf(text) + 1;
}

export { toggleTaskListItemAtLine, relocateTaskLine };
