import { describe, expect, it } from "bun:test";
import { parseAlacrittyToml } from "../../../src/services/theme-parsers/alacritty";

const DRACULA_TOML = `
[colors.primary]
foreground = "#f8f8f2"
background = "#282a36"

[colors.cursor]
text = "#282a36"
cursor = "#f8f8f2"

[colors.selection]
text = "#f8f8f2"
background = "#44475a"

[colors.normal]
black   = "#21222c"
red     = "#ff5555"
green   = "#50fa7b"
yellow  = "#f1fa8c"
blue    = "#bd93f9"
magenta = "#ff79c6"
cyan    = "#8be9fd"
white   = "#f8f8f2"

[colors.bright]
black   = "#6272a4"
red     = "#ff6e6e"
green   = "#69ff94"
yellow  = "#ffffa5"
blue    = "#d6acff"
magenta = "#ff92df"
cyan    = "#a4ffff"
white   = "#ffffff"
`;

describe("parseAlacrittyToml", () => {
    it("should parse Dracula theme", () => {
        const theme = parseAlacrittyToml(DRACULA_TOML, "Dracula");

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
        expect(theme!.colors.ansi.green).toBe("#50fa7b");
        expect(theme!.colors.ansi.brightBlack).toBe("#6272a4");
        expect(theme!.colors.ansi.brightWhite).toBe("#ffffff");
    });

    it("should return null for invalid TOML", () => {
        expect(parseAlacrittyToml("not valid toml {{{", "Bad")).toBeNull();
    });

    it("should return null when colors section is missing", () => {
        expect(parseAlacrittyToml("[font]\nsize = 12", "NoColors")).toBeNull();
    });

    it("should return null when foreground is missing", () => {
        const toml = `
[colors.primary]
background = "#282a36"

[colors.normal]
black = "#21222c"
red = "#ff5555"
green = "#50fa7b"
yellow = "#f1fa8c"
blue = "#bd93f9"
magenta = "#ff79c6"
cyan = "#8be9fd"
white = "#f8f8f2"

[colors.bright]
black = "#6272a4"
red = "#ff6e6e"
green = "#69ff94"
yellow = "#ffffa5"
blue = "#d6acff"
magenta = "#ff92df"
cyan = "#a4ffff"
white = "#ffffff"
`;
        expect(parseAlacrittyToml(toml, "NoFg")).toBeNull();
    });

    it("should return null when an ANSI color is missing", () => {
        const toml = `
[colors.primary]
foreground = "#f8f8f2"
background = "#282a36"

[colors.normal]
black = "#21222c"
red = "#ff5555"

[colors.bright]
black = "#6272a4"
`;
        expect(parseAlacrittyToml(toml, "Incomplete")).toBeNull();
    });

    it("should use fallback values when cursor/selection are missing", () => {
        const toml = `
[colors.primary]
foreground = "#f8f8f2"
background = "#282a36"

[colors.normal]
black   = "#21222c"
red     = "#ff5555"
green   = "#50fa7b"
yellow  = "#f1fa8c"
blue    = "#bd93f9"
magenta = "#ff79c6"
cyan    = "#8be9fd"
white   = "#f8f8f2"

[colors.bright]
black   = "#6272a4"
red     = "#ff6e6e"
green   = "#69ff94"
yellow  = "#ffffa5"
blue    = "#d6acff"
magenta = "#ff92df"
cyan    = "#a4ffff"
white   = "#ffffff"
`;
        const theme = parseAlacrittyToml(toml, "NoCursor");
        expect(theme).not.toBeNull();
        // Cursor falls back to foreground
        expect(theme!.colors.cursor).toBe("#f8f8f2");
        // CursorText falls back to background
        expect(theme!.colors.cursorText).toBe("#282a36");
        // Selection falls back to blue ANSI color
        expect(theme!.colors.selection).toBe("#bd93f9");
        // SelectionText falls back to foreground
        expect(theme!.colors.selectionText).toBe("#f8f8f2");
    });

    it("should handle hex values without # prefix", () => {
        const toml = `
[colors.primary]
foreground = "f8f8f2"
background = "282a36"

[colors.normal]
black   = "21222c"
red     = "ff5555"
green   = "50fa7b"
yellow  = "f1fa8c"
blue    = "bd93f9"
magenta = "ff79c6"
cyan    = "8be9fd"
white   = "f8f8f2"

[colors.bright]
black   = "6272a4"
red     = "ff6e6e"
green   = "69ff94"
yellow  = "ffffa5"
blue    = "d6acff"
magenta = "ff92df"
cyan    = "a4ffff"
white   = "ffffff"
`;
        const theme = parseAlacrittyToml(toml, "NoHash");
        expect(theme).not.toBeNull();
        expect(theme!.colors.foreground).toBe("#f8f8f2");
    });
});
