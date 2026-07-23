import { describe, expect, it } from "bun:test";
import { dirnameOf, joinRelative } from "./paths";

describe("dirnameOf", () => {
    it("drops the last segment", () => {
        expect(dirnameOf("/w/docs/wiki/business/money.md")).toBe("/w/docs/wiki/business");
    });

    it("normalises backslashes", () => {
        expect(dirnameOf("C:\\w\\docs\\money.md")).toBe("C:/w/docs");
    });

    it("returns the root for a top-level path", () => {
        expect(dirnameOf("/money.md")).toBe("");
    });
});

describe("joinRelative", () => {
    it("resolves a sibling", () => {
        expect(joinRelative("/w/docs", "./other.md")).toBe("/w/docs/other.md");
    });

    it("resolves a bare relative segment", () => {
        expect(joinRelative("/w/docs", "other.md")).toBe("/w/docs/other.md");
    });

    it("resolves parent traversal", () => {
        expect(joinRelative("/w/docs/business", "../money/currency.md")).toBe(
            "/w/docs/money/currency.md",
        );
    });

    it("collapses redundant segments", () => {
        expect(joinRelative("/w/docs", "./a/./b/../c.md")).toBe("/w/docs/a/c.md");
    });

    it("returns an absolute target unchanged", () => {
        expect(joinRelative("/w/docs", "/etc/hosts")).toBe("/etc/hosts");
    });

    it("does not climb above the filesystem root", () => {
        expect(joinRelative("/w", "../../../etc/hosts")).toBe("/etc/hosts");
    });

    it("decodes percent-encoded segments", () => {
        expect(joinRelative("/w/docs", "my%20page.md")).toBe("/w/docs/my page.md");
    });
});
