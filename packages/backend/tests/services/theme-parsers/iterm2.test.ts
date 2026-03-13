import { describe, expect, it } from "bun:test";
import { parseIterm2Xml } from "../../../src/services/theme-parsers/iterm2";

function makeColorDict(r: number, g: number, b: number): string {
    return `<dict>
        <key>Red Component</key><real>${r}</real>
        <key>Green Component</key><real>${g}</real>
        <key>Blue Component</key><real>${b}</real>
    </dict>`;
}

describe("color component conversion", () => {
    it("should convert float 0.0 to #000000", () => {
        // Minimal plist with all black to verify 0.0 → 00
        const xml = `<?xml version="1.0"?><plist version="1.0"><dict>
            <key>Foreground Color</key>${makeColorDict(0, 0, 0)}
            <key>Background Color</key>${makeColorDict(0, 0, 0)}
            ${Array.from({ length: 16 }, (_, i) => `<key>Ansi ${i} Color</key>${makeColorDict(0, 0, 0)}`).join("\n")}
        </dict></plist>`;
        const theme = parseIterm2Xml(xml, "AllBlack");
        expect(theme).not.toBeNull();
        expect(theme!.colors.foreground).toBe("#000000");
    });

    it("should convert float 1.0 to #ffffff", () => {
        const xml = `<?xml version="1.0"?><plist version="1.0"><dict>
            <key>Foreground Color</key>${makeColorDict(1, 1, 1)}
            <key>Background Color</key>${makeColorDict(0, 0, 0)}
            ${Array.from({ length: 16 }, (_, i) => `<key>Ansi ${i} Color</key>${makeColorDict(0, 0, 0)}`).join("\n")}
        </dict></plist>`;
        const theme = parseIterm2Xml(xml, "White");
        expect(theme).not.toBeNull();
        expect(theme!.colors.foreground).toBe("#ffffff");
    });

    it("should convert specific float RGB to correct hex", () => {
        // 0.976 * 255 ≈ 249 = f9, 0.545 * 255 ≈ 139 = 8b, 0.659 * 255 ≈ 168 = a8
        const xml = `<?xml version="1.0"?><plist version="1.0"><dict>
            <key>Foreground Color</key>${makeColorDict(0.976470588235294, 0.545098039215686, 0.658823529411765)}
            <key>Background Color</key>${makeColorDict(0, 0, 0)}
            ${Array.from({ length: 16 }, (_, i) => `<key>Ansi ${i} Color</key>${makeColorDict(0, 0, 0)}`).join("\n")}
        </dict></plist>`;
        const theme = parseIterm2Xml(xml, "Pink");
        expect(theme).not.toBeNull();
        expect(theme!.colors.foreground).toBe("#f98ba8");
    });

    it("should return null when color components are missing", () => {
        const xml = `<?xml version="1.0"?><plist version="1.0"><dict>
            <key>Foreground Color</key><dict>
                <key>Red Component</key><real>0.5</real>
                <key>Green Component</key><real>0.5</real>
            </dict>
            <key>Background Color</key>${makeColorDict(0, 0, 0)}
            ${Array.from({ length: 16 }, (_, i) => `<key>Ansi ${i} Color</key>${makeColorDict(0, 0, 0)}`).join("\n")}
        </dict></plist>`;
        expect(parseIterm2Xml(xml, "Missing")).toBeNull();
    });
});

const SAMPLE_PLIST = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Foreground Color</key>
    <dict>
        <key>Red Component</key>
        <real>0.97254901960784312</real>
        <key>Green Component</key>
        <real>0.97254901960784312</real>
        <key>Blue Component</key>
        <real>0.94901960784313721</real>
    </dict>
    <key>Background Color</key>
    <dict>
        <key>Red Component</key>
        <real>0.15686274509803921</real>
        <key>Green Component</key>
        <real>0.16470588235294117</real>
        <key>Blue Component</key>
        <real>0.21176470588235294</real>
    </dict>
    <key>Cursor Color</key>
    <dict>
        <key>Red Component</key>
        <real>0.97254901960784312</real>
        <key>Green Component</key>
        <real>0.97254901960784312</real>
        <key>Blue Component</key>
        <real>0.94901960784313721</real>
    </dict>
    <key>Cursor Text Color</key>
    <dict>
        <key>Red Component</key>
        <real>0.15686274509803921</real>
        <key>Green Component</key>
        <real>0.16470588235294117</real>
        <key>Blue Component</key>
        <real>0.21176470588235294</real>
    </dict>
    <key>Selection Color</key>
    <dict>
        <key>Red Component</key>
        <real>0.26666666666666666</real>
        <key>Green Component</key>
        <real>0.27843137254901962</real>
        <key>Blue Component</key>
        <real>0.35294117647058826</real>
    </dict>
    <key>Selected Text Color</key>
    <dict>
        <key>Red Component</key>
        <real>0.97254901960784312</real>
        <key>Green Component</key>
        <real>0.97254901960784312</real>
        <key>Blue Component</key>
        <real>0.94901960784313721</real>
    </dict>
    <key>Ansi 0 Color</key>
    <dict>
        <key>Red Component</key>
        <real>0.12941176470588237</real>
        <key>Green Component</key>
        <real>0.13333333333333333</real>
        <key>Blue Component</key>
        <real>0.17254901960784313</real>
    </dict>
    <key>Ansi 1 Color</key>
    <dict>
        <key>Red Component</key>
        <real>1.0</real>
        <key>Green Component</key>
        <real>0.33333333333333331</real>
        <key>Blue Component</key>
        <real>0.33333333333333331</real>
    </dict>
    <key>Ansi 2 Color</key>
    <dict>
        <key>Red Component</key>
        <real>0.31372549019607843</real>
        <key>Green Component</key>
        <real>0.98039215686274506</real>
        <key>Blue Component</key>
        <real>0.4823529411764706</real>
    </dict>
    <key>Ansi 3 Color</key>
    <dict>
        <key>Red Component</key>
        <real>0.94509803921568625</real>
        <key>Green Component</key>
        <real>0.98039215686274506</real>
        <key>Blue Component</key>
        <real>0.5490196078431373</real>
    </dict>
    <key>Ansi 4 Color</key>
    <dict>
        <key>Red Component</key>
        <real>0.74117647058823533</real>
        <key>Green Component</key>
        <real>0.57647058823529407</real>
        <key>Blue Component</key>
        <real>0.97647058823529409</real>
    </dict>
    <key>Ansi 5 Color</key>
    <dict>
        <key>Red Component</key>
        <real>1.0</real>
        <key>Green Component</key>
        <real>0.47450980392156861</real>
        <key>Blue Component</key>
        <real>0.77647058823529413</real>
    </dict>
    <key>Ansi 6 Color</key>
    <dict>
        <key>Red Component</key>
        <real>0.54509803921568623</real>
        <key>Green Component</key>
        <real>0.91372549019607843</real>
        <key>Blue Component</key>
        <real>0.99215686274509807</real>
    </dict>
    <key>Ansi 7 Color</key>
    <dict>
        <key>Red Component</key>
        <real>0.97254901960784312</real>
        <key>Green Component</key>
        <real>0.97254901960784312</real>
        <key>Blue Component</key>
        <real>0.94901960784313721</real>
    </dict>
    <key>Ansi 8 Color</key>
    <dict>
        <key>Red Component</key>
        <real>0.38431372549019605</real>
        <key>Green Component</key>
        <real>0.44705882352941179</real>
        <key>Blue Component</key>
        <real>0.64313725490196083</real>
    </dict>
    <key>Ansi 9 Color</key>
    <dict>
        <key>Red Component</key>
        <real>1.0</real>
        <key>Green Component</key>
        <real>0.43137254901960786</real>
        <key>Blue Component</key>
        <real>0.43137254901960786</real>
    </dict>
    <key>Ansi 10 Color</key>
    <dict>
        <key>Red Component</key>
        <real>0.41176470588235292</real>
        <key>Green Component</key>
        <real>1.0</real>
        <key>Blue Component</key>
        <real>0.58039215686274515</real>
    </dict>
    <key>Ansi 11 Color</key>
    <dict>
        <key>Red Component</key>
        <real>1.0</real>
        <key>Green Component</key>
        <real>1.0</real>
        <key>Blue Component</key>
        <real>0.6470588235294118</real>
    </dict>
    <key>Ansi 12 Color</key>
    <dict>
        <key>Red Component</key>
        <real>0.83921568627450982</real>
        <key>Green Component</key>
        <real>0.67450980392156867</real>
        <key>Blue Component</key>
        <real>1.0</real>
    </dict>
    <key>Ansi 13 Color</key>
    <dict>
        <key>Red Component</key>
        <real>1.0</real>
        <key>Green Component</key>
        <real>0.57254901960784310</real>
        <key>Blue Component</key>
        <real>0.87450980392156863</real>
    </dict>
    <key>Ansi 14 Color</key>
    <dict>
        <key>Red Component</key>
        <real>0.64313725490196083</real>
        <key>Green Component</key>
        <real>1.0</real>
        <key>Blue Component</key>
        <real>1.0</real>
    </dict>
    <key>Ansi 15 Color</key>
    <dict>
        <key>Red Component</key>
        <real>1.0</real>
        <key>Green Component</key>
        <real>1.0</real>
        <key>Blue Component</key>
        <real>1.0</real>
    </dict>
</dict>
</plist>`;

describe("parseIterm2Xml", () => {
    it("should parse a complete iTerm2 plist", () => {
        const theme = parseIterm2Xml(SAMPLE_PLIST, "Dracula");

        expect(theme).not.toBeNull();
        expect(theme!.name).toBe("Dracula");
        expect(theme!.origin).toBe("imported");
        expect(theme!.version).toBe(1);
        expect(theme!.colors.foreground).toBe("#f8f8f2");
        expect(theme!.colors.background).toBe("#282a36");
        expect(theme!.colors.ansi.black).toBe("#21222c");
        expect(theme!.colors.ansi.brightWhite).toBe("#ffffff");
    });

    it("should extract cursor colors", () => {
        const theme = parseIterm2Xml(SAMPLE_PLIST, "Test");
        expect(theme).not.toBeNull();
        expect(theme!.colors.cursor).toBe("#f8f8f2");
        expect(theme!.colors.cursorText).toBe("#282a36");
    });

    it("should extract selection colors", () => {
        const theme = parseIterm2Xml(SAMPLE_PLIST, "Test");
        expect(theme).not.toBeNull();
        expect(theme!.colors.selection).toBe("#44475a");
        expect(theme!.colors.selectionText).toBe("#f8f8f2");
    });

    it("should return null for empty XML", () => {
        expect(parseIterm2Xml("", "Empty")).toBeNull();
    });

    it("should return null when Foreground Color is missing", () => {
        const xml = `<?xml version="1.0"?>
<plist version="1.0">
<dict>
    <key>Background Color</key>
    <dict>
        <key>Red Component</key>
        <real>0.0</real>
        <key>Green Component</key>
        <real>0.0</real>
        <key>Blue Component</key>
        <real>0.0</real>
    </dict>
</dict>
</plist>`;
        expect(parseIterm2Xml(xml, "NoFg")).toBeNull();
    });

    it("should return null when ANSI colors are missing", () => {
        const xml = `<?xml version="1.0"?>
<plist version="1.0">
<dict>
    <key>Foreground Color</key>
    <dict>
        <key>Red Component</key>
        <real>1.0</real>
        <key>Green Component</key>
        <real>1.0</real>
        <key>Blue Component</key>
        <real>1.0</real>
    </dict>
    <key>Background Color</key>
    <dict>
        <key>Red Component</key>
        <real>0.0</real>
        <key>Green Component</key>
        <real>0.0</real>
        <key>Blue Component</key>
        <real>0.0</real>
    </dict>
</dict>
</plist>`;
        expect(parseIterm2Xml(xml, "NoAnsi")).toBeNull();
    });
});
