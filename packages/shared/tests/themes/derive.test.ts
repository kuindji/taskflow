import { describe, it, expect } from "bun:test";
import { deriveTheme } from "../../src/themes/derive";
import type { ThemeSource } from "../../src/types/theme";

const dracula: ThemeSource = {
    version: 1,
    name: "Dracula",
    origin: "bundled",
    colors: {
        foreground: "#f8f8f2",
        background: "#282a36",
        cursor: "#f8f8f2",
        cursorText: "#282a36",
        selection: "#44475a",
        selectionText: "#f8f8f2",
        ansi: {
            black: "#21222c",
            red: "#ff5555",
            green: "#50fa7b",
            yellow: "#f1fa8c",
            blue: "#bd93f9",
            magenta: "#ff79c6",
            cyan: "#8be9fd",
            white: "#f8f8f2",
            brightBlack: "#6272a4",
            brightRed: "#ff6e6e",
            brightGreen: "#69ff94",
            brightYellow: "#ffffa5",
            brightBlue: "#d6acff",
            brightMagenta: "#ff92df",
            brightCyan: "#a4ffff",
            brightWhite: "#ffffff",
        },
    },
};

describe("deriveTheme", () => {
    it("maps background and foreground directly", () => {
        const resolved = deriveTheme(dracula);
        expect(resolved.css["--background"]).toBe("#282a36");
        expect(resolved.css["--foreground"]).toBe("#f8f8f2");
    });

    it("maps card to ansi.black", () => {
        const resolved = deriveTheme(dracula);
        expect(resolved.css["--card"]).toBe("#21222c");
    });

    it("maps accent to ansi.blue", () => {
        const resolved = deriveTheme(dracula);
        expect(resolved.css["--accent"]).toBe("#bd93f9");
    });

    it("maps destructive to ansi.red", () => {
        const resolved = deriveTheme(dracula);
        expect(resolved.css["--destructive"]).toBe("#ff5555");
    });

    it("maps muted-foreground to ansi.brightBlack", () => {
        const resolved = deriveTheme(dracula);
        expect(resolved.css["--muted-foreground"]).toBe("#6272a4");
    });

    it("maps secondary-foreground to ansi.brightWhite", () => {
        const resolved = deriveTheme(dracula);
        expect(resolved.css["--secondary-foreground"]).toBe("#ffffff");
    });

    it("maps border directly to selection", () => {
        const resolved = deriveTheme(dracula);
        expect(resolved.css["--border"]).toBe("#44475a");
    });

    it("maps info to ansi.blue (same as accent)", () => {
        const resolved = deriveTheme(dracula);
        expect(resolved.css["--info"]).toBe("#bd93f9");
    });

    it("derives island-base as ansi.black with 50% opacity", () => {
        const resolved = deriveTheme(dracula);
        expect(resolved.css["--island-base"]).toBe("rgba(33, 34, 44, 0.5)");
    });

    it("maps chart colors: blue, green, yellow, red, magenta", () => {
        const resolved = deriveTheme(dracula);
        expect(resolved.css["--chart-1"]).toBe("#bd93f9");
        expect(resolved.css["--chart-2"]).toBe("#50fa7b");
        expect(resolved.css["--chart-3"]).toBe("#f1fa8c");
        expect(resolved.css["--chart-4"]).toBe("#ff5555");
        expect(resolved.css["--chart-5"]).toBe("#ff79c6");
    });

    it("produces xterm theme with all 20 colors", () => {
        const resolved = deriveTheme(dracula);
        expect(resolved.xterm.background).toBe("#282a36");
        expect(resolved.xterm.foreground).toBe("#f8f8f2");
        expect(resolved.xterm.cursor).toBe("#f8f8f2");
        expect(resolved.xterm.cursorAccent).toBe("#282a36");
        expect(resolved.xterm.red).toBe("#ff5555");
        expect(resolved.xterm.brightCyan).toBe("#a4ffff");
    });

    it("applies overrides over derived values", () => {
        const withOverrides: ThemeSource = {
            ...dracula,
            overrides: { "--border": "#999999" },
        };
        const resolved = deriveTheme(withOverrides);
        expect(resolved.css["--border"]).toBe("#999999");
    });

    it("preserves the source in resolved theme", () => {
        const resolved = deriveTheme(dracula);
        expect(resolved.source.name).toBe("Dracula");
    });
});
