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

export { toggleTaskListItemAtLine };
