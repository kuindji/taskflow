import { visit, SKIP } from "unist-util-visit";
import type { Link, Parent, Root, RootContent, Text } from "mdast";
import GithubSlugger from "github-slugger";
import { parseWikiLinks } from "@taskflow/shared";

interface WikiLinkResolution {
    href: string;
    exists: boolean;
}

interface RemarkWikiLinkOptions {
    /** Map a `[[target]]` to an href, and say whether the page exists. */
    resolve: (target: string) => WikiLinkResolution;
}

/**
 * Rewrite `[[path]]`, `[[path|alias]]` and `[[path#heading]]` into ordinary
 * link nodes so the preview's existing delegated click handler routes them.
 * Unresolvable targets get a distinct class rather than silently looking valid.
 */
function remarkWikiLink({ resolve }: RemarkWikiLinkOptions) {
    return (tree: Root): void => {
        visit(tree, "text", (node: Text, index, parent: Parent | undefined) => {
            if (parent === undefined || index === undefined) return;
            // Text inside an existing link must stay literal — a wiki-link
            // inside a markdown link is the author's text, not a target.
            if (parent.type === "link" || parent.type === "linkReference") return SKIP;

            const spans = parseWikiLinks(node.value);
            if (spans.length === 0) return;

            const replacement: RootContent[] = [];
            let cursor = 0;

            for (const span of spans) {
                if (span.start > cursor) {
                    replacement.push({ type: "text", value: node.value.slice(cursor, span.start) });
                }
                const { href, exists } = resolve(span.target);
                // `[[page#Exchange Rates]]` must land on the id rehype-slug
                // emitted ("exchange-rates"), so slug the fragment here.
                const url =
                    span.hash === undefined ? href : `${href}#${new GithubSlugger().slug(span.hash)}`;
                const link: Link = {
                    type: "link",
                    url,
                    children: [{ type: "text", value: span.alias ?? span.target }],
                    data: {
                        hProperties: {
                            className: exists ? "wiki-link" : "wiki-link wiki-link-broken",
                        },
                    },
                };
                replacement.push(link);
                cursor = span.end;
            }

            if (cursor < node.value.length) {
                replacement.push({ type: "text", value: node.value.slice(cursor) });
            }

            parent.children.splice(index, 1, ...replacement);
            return index + replacement.length;
        });
    };
}

export { remarkWikiLink };
