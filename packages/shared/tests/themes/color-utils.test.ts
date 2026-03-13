import { describe, it, expect } from "bun:test";
import { lighten, hexToRgba } from "../../src/themes/color-utils";

describe("lighten", () => {
    it("lightens a dark color by 10%", () => {
        const result = lighten("#44475a", 0.1);
        // Each channel increases by (255 - channel) * 0.1
        // R: 68 + (255-68)*0.1 = 68 + 18.7 = 87 → #57
        // G: 71 + (255-71)*0.1 = 71 + 18.4 = 89 → #59
        // B: 90 + (255-90)*0.1 = 90 + 16.5 = 107 → #6b
        expect(result).toBe("#57596b");
    });

    it("does not exceed #ffffff", () => {
        expect(lighten("#ffffff", 0.5)).toBe("#ffffff");
    });

    it("lightens black", () => {
        expect(lighten("#000000", 0.5)).toBe("#808080");
    });
});

describe("hexToRgba", () => {
    it("converts hex to rgba string", () => {
        expect(hexToRgba("#1e1e2e", 0.5)).toBe("rgba(30, 30, 46, 0.5)");
    });

    it("handles full opacity", () => {
        expect(hexToRgba("#ff0000", 1)).toBe("rgba(255, 0, 0, 1)");
    });
});
