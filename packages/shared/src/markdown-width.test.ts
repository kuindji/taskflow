import { describe, expect, it } from "bun:test";
import { DEFAULT_EDITOR_MARKDOWN_WIDTH, markdownWidthCss } from "./constants";

describe("markdownWidthCss", () => {
    it("defaults to medium", () => {
        expect(DEFAULT_EDITOR_MARKDOWN_WIDTH).toBe("medium");
    });

    it("maps each width to a reading measure", () => {
        expect(markdownWidthCss("narrow")).toBe("62ch");
        expect(markdownWidthCss("medium")).toBe("74ch");
        expect(markdownWidthCss("wide")).toBe("88ch");
    });

    it("maps full to no cap", () => {
        expect(markdownWidthCss("full")).toBe("none");
    });
});
