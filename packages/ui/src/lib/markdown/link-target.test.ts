import { describe, expect, it } from "bun:test";
import { resolveLinkTarget } from "./link-target";

const CURRENT = "/w/docs/wiki/business/money.md";

describe("resolveLinkTarget", () => {
    it("treats a bare fragment as an in-page anchor", () => {
        expect(resolveLinkTarget("#currency-notes", CURRENT)).toEqual({
            kind: "anchor",
            hash: "currency-notes",
        });
    });

    it("routes a relative markdown link to the same tab", () => {
        expect(resolveLinkTarget("./glossary.md", CURRENT)).toEqual({
            kind: "markdown",
            path: "/w/docs/wiki/business/glossary.md",
        });
    });

    it("carries a fragment on a markdown link", () => {
        expect(resolveLinkTarget("../money/currency.md#rates", CURRENT)).toEqual({
            kind: "markdown",
            path: "/w/docs/wiki/money/currency.md",
            hash: "rates",
        });
    });

    it("routes other relative files to the file opener", () => {
        expect(resolveLinkTarget("./diagram.png", CURRENT)).toEqual({
            kind: "file",
            path: "/w/docs/wiki/business/diagram.png",
        });
    });

    it("routes http and https to the external browser", () => {
        expect(resolveLinkTarget("https://example.com/x", CURRENT)).toEqual({
            kind: "external",
            url: "https://example.com/x",
        });
        expect(resolveLinkTarget("http://example.com", CURRENT)).toEqual({
            kind: "external",
            url: "http://example.com",
        });
    });

    it("ignores empty hrefs and unsupported schemes", () => {
        expect(resolveLinkTarget("", CURRENT)).toEqual({ kind: "ignore" });
        expect(resolveLinkTarget("#", CURRENT)).toEqual({ kind: "ignore" });
        expect(resolveLinkTarget("javascript:alert(1)", CURRENT)).toEqual({ kind: "ignore" });
        expect(resolveLinkTarget("mailto:a@b.c", CURRENT)).toEqual({ kind: "ignore" });
        expect(resolveLinkTarget("data:text/html,<b>", CURRENT)).toEqual({ kind: "ignore" });
    });

    it("treats a Windows drive letter as a path, not a URL scheme", () => {
        expect(resolveLinkTarget("C:/w/docs/other.md", "C:/w/docs/money.md")).toEqual({
            kind: "markdown",
            path: "C:/w/docs/other.md",
        });
    });
});
