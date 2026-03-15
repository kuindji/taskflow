import { describe, expect, it } from "bun:test";
import { parseTerminalAppXml } from "../../../src/services/theme-parsers/terminal-app";

function makeColorDict(r: number, g: number, b: number): string {
    return `<dict>
        <key>Red Component</key><real>${r}</real>
        <key>Green Component</key><real>${g}</real>
        <key>Blue Component</key><real>${b}</real>
    </dict>`;
}

const SAMPLE_TERMINAL = `<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0">
<dict>
    <key>name</key><string>Classic Dark</string>
    <key>TextColor</key>${makeColorDict(0.95, 0.95, 0.95)}
    <key>BackgroundColor</key>${makeColorDict(0.1, 0.1, 0.1)}
    <key>CursorColor</key>${makeColorDict(0.95, 0.95, 0.95)}
    <key>SelectionColor</key>${makeColorDict(0.25, 0.25, 0.4)}
    <key>ANSIBlackColor</key>${makeColorDict(0.0, 0.0, 0.0)}
    <key>ANSIRedColor</key>${makeColorDict(1.0, 0.0, 0.0)}
    <key>ANSIGreenColor</key>${makeColorDict(0.0, 1.0, 0.0)}
    <key>ANSIYellowColor</key>${makeColorDict(1.0, 1.0, 0.0)}
    <key>ANSIBlueColor</key>${makeColorDict(0.0, 0.0, 1.0)}
    <key>ANSIMagentaColor</key>${makeColorDict(1.0, 0.0, 1.0)}
    <key>ANSICyanColor</key>${makeColorDict(0.0, 1.0, 1.0)}
    <key>ANSIWhiteColor</key>${makeColorDict(1.0, 1.0, 1.0)}
</dict>
</plist>`;

describe("parseTerminalAppXml", () => {
    it("parses recognizable .terminal plist colors", () => {
        const theme = parseTerminalAppXml(SAMPLE_TERMINAL, "Fallback");

        expect(theme).not.toBeNull();
        expect(theme!.name).toBe("Classic Dark");
        expect(theme!.colors.foreground).toBe("#f2f2f2");
        expect(theme!.colors.background).toBe("#1a1a1a");
        expect(theme!.colors.cursor).toBe("#f2f2f2");
        expect(theme!.colors.selection).toBe("#404066");
        expect(theme!.colors.ansi.blue).toBe("#0000ff");
        expect(theme!.colors.ansi.brightBlue).toBe("#0000ff");
    });

    it("returns null for unsupported plist content", () => {
        expect(parseTerminalAppXml('<plist version="1.0"><dict /></plist>', "Bad")).toBeNull();
    });
});
