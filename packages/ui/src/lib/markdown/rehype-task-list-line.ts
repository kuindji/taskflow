import { visit } from "unist-util-visit";
import type { Element, Root } from "hast";

/**
 * Copy each list item's source line onto the rendered element as
 * `data-source-line`. `mdast-util-to-hast` carries the mdast `position` through
 * to the hast node, so this is the renderer's own idea of where the item came
 * from — not a second guess at parsing the document.
 */
function rehypeTaskListLine() {
    return (tree: Root): void => {
        visit(tree, "element", (node: Element) => {
            if (node.tagName !== "li") return;
            const line = node.position?.start.line;
            if (line === undefined) return;
            node.properties = { ...node.properties, dataSourceLine: line };
        });
    };
}

export { rehypeTaskListLine };
