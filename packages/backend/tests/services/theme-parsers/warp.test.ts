import { describe, expect, it } from "bun:test";
import { parseWarpYaml } from "../../../src/services/theme-parsers/warp";

const DRACULA_YAML = `
accent: '#bd93f9'
background: '#282a36'
foreground: '#f8f8f2'
cursor: '#f8f8f2'
terminal_colors:
  normal:
    black: '#21222c'
    red: '#ff5555'
    green: '#50fa7b'
    yellow: '#f1fa8c'
    blue: '#bd93f9'
    magenta: '#ff79c6'
    cyan: '#8be9fd'
    white: '#f8f8f2'
  bright:
    black: '#6272a4'
    red: '#ff6e6e'
    green: '#69ff94'
    yellow: '#ffffa5'
    blue: '#d6acff'
    magenta: '#ff92df'
    cyan: '#a4ffff'
    white: '#ffffff'
`;

describe("parseWarpYaml", () => {
    it("should parse Dracula theme", () => {
        const theme = parseWarpYaml(DRACULA_YAML, "Dracula");

        expect(theme).not.toBeNull();
        expect(theme!.name).toBe("Dracula");
        expect(theme!.origin).toBe("imported");
        expect(theme!.version).toBe(1);
        expect(theme!.colors.foreground).toBe("#f8f8f2");
        expect(theme!.colors.background).toBe("#282a36");
        expect(theme!.colors.cursor).toBe("#f8f8f2");
        expect(theme!.colors.cursorText).toBe("#282a36");
        expect(theme!.colors.ansi.black).toBe("#21222c");
        expect(theme!.colors.ansi.red).toBe("#ff5555");
        expect(theme!.colors.ansi.brightWhite).toBe("#ffffff");
    });

    it("should fall back cursor to foreground when cursor is not specified", () => {
        const yaml = `
background: '#282a36'
foreground: '#f8f8f2'
terminal_colors:
  normal:
    black: '#21222c'
    red: '#ff5555'
    green: '#50fa7b'
    yellow: '#f1fa8c'
    blue: '#bd93f9'
    magenta: '#ff79c6'
    cyan: '#8be9fd'
    white: '#f8f8f2'
  bright:
    black: '#6272a4'
    red: '#ff6e6e'
    green: '#69ff94'
    yellow: '#ffffa5'
    blue: '#d6acff'
    magenta: '#ff92df'
    cyan: '#a4ffff'
    white: '#ffffff'
`;
        const theme = parseWarpYaml(yaml, "NoCursor");
        expect(theme).not.toBeNull();
        expect(theme!.colors.cursor).toBe("#f8f8f2");
    });

    it("should return null when foreground is missing", () => {
        const yaml = `
background: '#282a36'
terminal_colors:
  normal:
    black: '#21222c'
`;
        expect(parseWarpYaml(yaml, "NoFg")).toBeNull();
    });

    it("should return null when terminal_colors are incomplete", () => {
        const yaml = `
background: '#282a36'
foreground: '#f8f8f2'
terminal_colors:
  normal:
    black: '#21222c'
    red: '#ff5555'
`;
        expect(parseWarpYaml(yaml, "Incomplete")).toBeNull();
    });

    it("should return null for invalid YAML", () => {
        expect(parseWarpYaml("{{invalid yaml::", "Bad")).toBeNull();
    });

    it("should return null for non-object YAML", () => {
        expect(parseWarpYaml("just a string", "NotObj")).toBeNull();
    });
});
