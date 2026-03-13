import { describe, expect, it } from "bun:test";
import { parseGhosttyConfig } from "../../../src/services/theme-parsers/ghostty";

const DRACULA_CONFIG = `
# Ghostty Dracula theme
background = #282a36
foreground = #f8f8f2
cursor-color = #f8f8f2
cursor-text = #282a36
selection-background = #44475a
selection-foreground = #f8f8f2

palette = 0=#21222c
palette = 1=#ff5555
palette = 2=#50fa7b
palette = 3=#f1fa8c
palette = 4=#bd93f9
palette = 5=#ff79c6
palette = 6=#8be9fd
palette = 7=#f8f8f2
palette = 8=#6272a4
palette = 9=#ff6e6e
palette = 10=#69ff94
palette = 11=#ffffa5
palette = 12=#d6acff
palette = 13=#ff92df
palette = 14=#a4ffff
palette = 15=#ffffff
`;

describe("parseGhosttyConfig", () => {
    it("should parse Dracula theme", () => {
        const theme = parseGhosttyConfig(DRACULA_CONFIG, "Dracula");

        expect(theme).not.toBeNull();
        expect(theme!.name).toBe("Dracula");
        expect(theme!.origin).toBe("imported");
        expect(theme!.version).toBe(1);
        expect(theme!.colors.foreground).toBe("#f8f8f2");
        expect(theme!.colors.background).toBe("#282a36");
        expect(theme!.colors.cursor).toBe("#f8f8f2");
        expect(theme!.colors.cursorText).toBe("#282a36");
        expect(theme!.colors.selection).toBe("#44475a");
        expect(theme!.colors.selectionText).toBe("#f8f8f2");
        expect(theme!.colors.ansi.black).toBe("#21222c");
        expect(theme!.colors.ansi.red).toBe("#ff5555");
        expect(theme!.colors.ansi.brightWhite).toBe("#ffffff");
    });

    it("should return null when foreground is missing", () => {
        const config = `
background = #282a36
palette = 0=#21222c
palette = 1=#ff5555
palette = 2=#50fa7b
palette = 3=#f1fa8c
palette = 4=#bd93f9
palette = 5=#ff79c6
palette = 6=#8be9fd
palette = 7=#f8f8f2
palette = 8=#6272a4
palette = 9=#ff6e6e
palette = 10=#69ff94
palette = 11=#ffffa5
palette = 12=#d6acff
palette = 13=#ff92df
palette = 14=#a4ffff
palette = 15=#ffffff
`;
        expect(parseGhosttyConfig(config, "NoFg")).toBeNull();
    });

    it("should return null when palette colors are incomplete", () => {
        const config = `
background = #282a36
foreground = #f8f8f2
palette = 0=#21222c
palette = 1=#ff5555
`;
        expect(parseGhosttyConfig(config, "Incomplete")).toBeNull();
    });

    it("should skip comment lines", () => {
        const config = `
# This is a comment
background = #282a36
foreground = #f8f8f2
# Another comment
palette = 0=#21222c
palette = 1=#ff5555
palette = 2=#50fa7b
palette = 3=#f1fa8c
palette = 4=#bd93f9
palette = 5=#ff79c6
palette = 6=#8be9fd
palette = 7=#f8f8f2
palette = 8=#6272a4
palette = 9=#ff6e6e
palette = 10=#69ff94
palette = 11=#ffffa5
palette = 12=#d6acff
palette = 13=#ff92df
palette = 14=#a4ffff
palette = 15=#ffffff
`;
        const theme = parseGhosttyConfig(config, "WithComments");
        expect(theme).not.toBeNull();
        expect(theme!.colors.foreground).toBe("#f8f8f2");
    });

    it("should use fallbacks when cursor/selection are missing", () => {
        const config = `
background = #282a36
foreground = #f8f8f2
palette = 0=#21222c
palette = 1=#ff5555
palette = 2=#50fa7b
palette = 3=#f1fa8c
palette = 4=#bd93f9
palette = 5=#ff79c6
palette = 6=#8be9fd
palette = 7=#f8f8f2
palette = 8=#6272a4
palette = 9=#ff6e6e
palette = 10=#69ff94
palette = 11=#ffffa5
palette = 12=#d6acff
palette = 13=#ff92df
palette = 14=#a4ffff
palette = 15=#ffffff
`;
        const theme = parseGhosttyConfig(config, "NoCursor");
        expect(theme).not.toBeNull();
        expect(theme!.colors.cursor).toBe("#f8f8f2"); // falls back to fg
        expect(theme!.colors.cursorText).toBe("#282a36"); // falls back to bg
        expect(theme!.colors.selection).toBe("#bd93f9"); // falls back to blue
        expect(theme!.colors.selectionText).toBe("#f8f8f2"); // falls back to fg
    });
});
