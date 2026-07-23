import { describe, expect, it } from "bun:test";
import type { ParsedWikiPage } from "../../src/services/wiki-page";
import { buildWikiGraph } from "../../src/services/wiki-graph";

function page(id: string, overrides: Partial<ParsedWikiPage> = {}): ParsedWikiPage {
    return {
        id,
        path: `${id}.md`,
        title: id.split("/").pop() ?? id,
        parents: [],
        children: [],
        relatedPages: [],
        headings: [],
        rawLinks: [],
        mtimeMs: 0,
        ...overrides,
    };
}

describe("buildWikiGraph", () => {
    it("splits resolved links from broken ones", () => {
        const graph = buildWikiGraph("/root", true, [
            page("a", { rawLinks: ["b", "nope"] }),
            page("b"),
        ]);
        const a = graph.pages.find((p) => p.id === "a");
        expect(a?.links).toEqual(["b"]);
        expect(a?.brokenLinks).toEqual(["nope"]);
        expect(graph.unresolved).toEqual([{ from: "a", target: "nope" }]);
    });

    it("builds the reverse backlink map", () => {
        const graph = buildWikiGraph("/root", true, [
            page("a", { rawLinks: ["c"] }),
            page("b", { rawLinks: ["c"] }),
            page("c"),
        ]);
        expect(graph.backlinks["c"]).toEqual(["a", "b"]);
        expect(graph.backlinks["a"]).toBeUndefined();
    });

    it("resolves a link that omits an index suffix to the folder index page", () => {
        const graph = buildWikiGraph("/root", true, [
            page("a", { rawLinks: ["business"] }),
            page("business/index"),
        ]);
        expect(graph.pages.find((p) => p.id === "a")?.links).toEqual(["business/index"]);
    });

    it("nests pages under folders in the tree", () => {
        const graph = buildWikiGraph("/root", true, [page("business/money"), page("readme")]);
        expect(graph.tree).toEqual([
            {
                name: "business",
                type: "folder",
                children: [{ name: "money", type: "page", id: "business/money" }],
            },
            { name: "readme", type: "page", id: "readme" },
        ]);
    });

    it("sorts folders before pages, then alphabetically", () => {
        const graph = buildWikiGraph("/root", true, [page("zeta"), page("alpha"), page("mid/one")]);
        expect(graph.tree.map((node) => node.name)).toEqual(["mid", "alpha", "zeta"]);
    });

    it("hoists a folder's index page onto the folder node", () => {
        const graph = buildWikiGraph("/root", true, [
            page("business/index"),
            page("business/alpha"),
        ]);
        const folder = graph.tree.find((node) => node.name === "business");
        expect(folder?.id).toBe("business/index");
        expect(folder?.children?.map((node) => node.id)).toEqual(["business/alpha"]);
    });

    it("also accepts README as a folder's index page", () => {
        const graph = buildWikiGraph("/root", true, [page("business/README")]);
        expect(graph.tree.find((node) => node.name === "business")?.id).toBe("business/README");
    });

    it("orders a folder's children by the index page's declared children list", () => {
        const graph = buildWikiGraph("/root", true, [
            page("business/index", { children: ["business/zeta", "business/alpha"] }),
            page("business/alpha"),
            page("business/zeta"),
        ]);
        const folder = graph.tree.find((node) => node.name === "business");
        expect(folder?.children?.map((node) => node.id)).toEqual([
            "business/zeta",
            "business/alpha",
        ]);
    });

    it("reports pages with no incoming links and no declared parent as orphans", () => {
        const graph = buildWikiGraph("/root", true, [
            page("a", { rawLinks: ["b"] }),
            page("b"),
            page("lonely"),
            page("has-parent", { parents: ["a"] }),
        ]);
        expect(graph.orphans).toEqual(["a", "lonely"]);
    });

    it("carries the root and its existence through", () => {
        expect(buildWikiGraph("/root", true, []).root).toBe("/root");
        expect(buildWikiGraph("/root", false, []).rootExists).toBe(false);
    });
});
