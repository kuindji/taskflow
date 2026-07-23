import { describe, expect, it } from "bun:test";
import type { Paragraph, Root, Text } from "mdast";
import { remarkWikiLink } from "./remark-wiki-link";

function paragraph(value: string): Root {
    const text: Text = { type: "text", value };
    const node: Paragraph = { type: "paragraph", children: [text] };
    return { type: "root", children: [node] };
}

const resolve = (target: string) => ({
    href: `/root/${target}.md`,
    exists: target !== "missing",
});

function run(value: string): Paragraph {
    const tree = paragraph(value);
    remarkWikiLink({ resolve })(tree);
    return tree.children[0] as Paragraph;
}

describe("remarkWikiLink", () => {
    it("replaces a wiki-link with a link node", () => {
        const node = run("see [[a/b]] now");
        expect(node.children.map((child) => child.type)).toEqual(["text", "link", "text"]);
        const link = node.children[1];
        if (link.type !== "link") throw new Error("expected a link node");
        expect(link.url).toBe("/root/a/b.md");
        expect((link.children[0] as Text).value).toBe("a/b");
    });

    it("uses the alias as the link text", () => {
        const link = run("[[a/b|Money]]").children[0];
        if (link.type !== "link") throw new Error("expected a link node");
        expect((link.children[0] as Text).value).toBe("Money");
    });

    it("appends the heading fragment to the url", () => {
        const link = run("[[a/b#rates]]").children[0];
        if (link.type !== "link") throw new Error("expected a link node");
        expect(link.url).toBe("/root/a/b.md#rates");
    });

    it("slugs a multi-word fragment so it matches the rendered heading id", () => {
        const link = run("[[a/b#Exchange Rates]]").children[0];
        if (link.type !== "link") throw new Error("expected a link node");
        expect(link.url).toBe("/root/a/b.md#exchange-rates");
    });

    it("marks an unresolvable target as broken", () => {
        const link = run("[[missing]]").children[0];
        if (link.type !== "link") throw new Error("expected a link node");
        expect(link.data?.hProperties).toEqual({ className: "wiki-link wiki-link-broken" });
    });

    it("marks a resolvable target as valid", () => {
        const link = run("[[a/b]]").children[0];
        if (link.type !== "link") throw new Error("expected a link node");
        expect(link.data?.hProperties).toEqual({ className: "wiki-link" });
    });

    it("handles several links in one text node", () => {
        expect(run("[[a]] and [[b]]").children.map((c) => c.type)).toEqual([
            "link",
            "text",
            "link",
        ]);
    });

    it("leaves text without wiki-links untouched", () => {
        const node = run("plain text");
        expect(node.children).toHaveLength(1);
        expect(node.children[0].type).toBe("text");
    });

    it("does not rewrite text inside an existing link", () => {
        const tree: Root = {
            type: "root",
            children: [
                {
                    type: "paragraph",
                    children: [
                        {
                            type: "link",
                            url: "./x.md",
                            children: [{ type: "text", value: "[[a/b]]" }],
                        },
                    ],
                },
            ],
        };
        remarkWikiLink({ resolve })(tree);
        const outer = (tree.children[0] as Paragraph).children[0];
        if (outer.type !== "link") throw new Error("expected a link node");
        expect(outer.children[0].type).toBe("text");
    });
});
