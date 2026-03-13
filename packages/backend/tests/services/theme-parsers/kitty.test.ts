import { describe, expect, it } from "bun:test";
import { parseKittyConfig } from "../../../src/services/theme-parsers/kitty";

const DRACULA_CONF = `
# Kitty Dracula theme
foreground #f8f8f2
background #282a36

cursor #f8f8f2
cursor_text_color #282a36

selection_foreground #f8f8f2
selection_background #44475a

color0 #21222c
color1 #ff5555
color2 #50fa7b
color3 #f1fa8c
color4 #bd93f9
color5 #ff79c6
color6 #8be9fd
color7 #f8f8f2

color8 #6272a4
color9 #ff6e6e
color10 #69ff94
color11 #ffffa5
color12 #d6acff
color13 #ff92df
color14 #a4ffff
color15 #ffffff
`;

describe("parseKittyConfig", () => {
    it("should parse Dracula theme", () => {
        const theme = parseKittyConfig(DRACULA_CONF, "Dracula");

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
        const conf = `
background #282a36
color0 #21222c
color1 #ff5555
`;
        expect(parseKittyConfig(conf, "NoFg")).toBeNull();
    });

    it("should return null when ANSI colors are incomplete", () => {
        const conf = `
foreground #f8f8f2
background #282a36
color0 #21222c
color1 #ff5555
`;
        expect(parseKittyConfig(conf, "Incomplete")).toBeNull();
    });

    it("should skip comment lines", () => {
        const theme = parseKittyConfig(DRACULA_CONF, "WithComments");
        expect(theme).not.toBeNull();
        expect(theme!.colors.foreground).toBe("#f8f8f2");
    });

    it("should use fallbacks when cursor/selection are missing", () => {
        const conf = `
foreground #f8f8f2
background #282a36
color0 #21222c
color1 #ff5555
color2 #50fa7b
color3 #f1fa8c
color4 #bd93f9
color5 #ff79c6
color6 #8be9fd
color7 #f8f8f2
color8 #6272a4
color9 #ff6e6e
color10 #69ff94
color11 #ffffa5
color12 #d6acff
color13 #ff92df
color14 #a4ffff
color15 #ffffff
`;
        const theme = parseKittyConfig(conf, "NoCursor");
        expect(theme).not.toBeNull();
        expect(theme!.colors.cursor).toBe("#f8f8f2");
        expect(theme!.colors.cursorText).toBe("#282a36");
        expect(theme!.colors.selection).toBe("#bd93f9");
        expect(theme!.colors.selectionText).toBe("#f8f8f2");
    });
});
