import { describe, expect, it } from "bun:test";
import {
    fileUriToPath,
    nativePath,
    pathFlavour,
    quoteDialect,
    relativeTo,
    resolveWithin,
    shellQuote,
} from "./path-flavour";

describe("pathFlavour", () => {
    it("is Windows only for a win32 backend; an older backend is POSIX", () => {
        expect(pathFlavour("win32")).toBe("windows");
        expect(pathFlavour("darwin")).toBe("posix");
        expect(pathFlavour("linux")).toBe("posix");
        expect(pathFlavour(undefined)).toBe("posix");
    });
});

describe("resolveWithin", () => {
    it.each([
        ["src/app.ts", "/repo", "/repo/src/app.ts"],
        ["./src/app.ts", "/repo", "/repo/src/app.ts"],
        ["src/../lib/a.ts", "/repo", "/repo/lib/a.ts"],
        ["/repo/src/app.ts", "/repo", "/repo/src/app.ts"],
        ["/repo", "/repo", "/repo"],
        ["../other/a.ts", "/repo", null],
        ["/repository/a.ts", "/repo", null],
        ["/etc/passwd", "/repo", null],
        ["/repo/../etc/passwd", "/repo", null],
        // A backslash is a file name character on POSIX, not a separator.
        ["src\\app.ts", "/repo", "/repo/src\\app.ts"],
    ])("POSIX: %s in %s → %s", (path, workingDir, expected) => {
        expect(resolveWithin(path, workingDir, "posix")).toBe(expected);
    });

    it.each([
        ["src\\app.ts", "C:\\repo", "C:/repo/src/app.ts"],
        ["src/app.ts", "C:\\repo", "C:/repo/src/app.ts"],
        [".\\src\\..\\lib\\a.ts", "C:\\repo", "C:/repo/lib/a.ts"],
        ["C:\\repo\\src\\app.ts", "C:\\repo", "C:/repo/src/app.ts"],
        ["C:/repo/src/app.ts", "C:\\repo", "C:/repo/src/app.ts"],
        // Case-insensitive, and spelled with the working directory's case.
        ["c:\\REPO\\src\\app.ts", "C:\\Repo", "C:/Repo/src/app.ts"],
        ["C:\\repo", "C:\\repo\\", "C:/repo"],
        ["..\\other\\a.ts", "C:\\repo", null],
        ["C:\\repository\\a.ts", "C:\\repo", null],
        ["D:\\repo\\a.ts", "C:\\repo", null],
        ["C:\\repo\\..\\Windows\\a.ts", "C:\\repo", null],
        ["src\\a.ts", "C:\\", "C:/src/a.ts"],
        ["a.ts", "\\\\server\\share\\repo", "//server/share/repo/a.ts"],
        ["..\\..\\a.ts", "\\\\server\\share\\repo", null],
    ])("Windows: %s in %s → %s", (path, workingDir, expected) => {
        expect(resolveWithin(path, workingDir, "windows")).toBe(expected);
    });
});

describe("relativeTo", () => {
    it("is empty for the root itself and null outside it", () => {
        expect(relativeTo("/repo", "/repo", "posix")).toBe("");
        expect(relativeTo("/repo", "/repo/a/b.ts", "posix")).toBe("a/b.ts");
        expect(relativeTo("/repo", "/Repo/a.ts", "posix")).toBeNull();
        expect(relativeTo("C:\\Repo", "c:\\repo", "windows")).toBe("");
        expect(relativeTo("C:\\Repo", "c:\\repo\\a\\b.ts", "windows")).toBe("a\\b.ts");
        expect(relativeTo("C:\\Repo", "D:\\repo\\a.ts", "windows")).toBeNull();
    });
});

describe("nativePath", () => {
    it("uses backslashes on Windows only", () => {
        expect(nativePath("C:/Repo/a b.ts", "windows")).toBe("C:\\Repo\\a b.ts");
        expect(nativePath("/repo/a.ts", "posix")).toBe("/repo/a.ts");
    });
});

describe("fileUriToPath", () => {
    it.each([
        ["file:///repo/My%20Docs/a.ts", "posix", "/repo/My Docs/a.ts"],
        ["file:///C:/repo/My%20Docs/a.ts", "windows", "C:\\repo\\My Docs\\a.ts"],
        ["file://server/share/a.ts", "windows", "\\\\server\\share\\a.ts"],
        ["https://example.com/a.ts", "posix", null],
        ["not a uri", "windows", null],
    ] as const)("%s (%s) → %s", (uri, flavour, expected) => {
        expect(fileUriToPath(uri, flavour)).toBe(expected);
    });
});

describe("shellQuote", () => {
    it.each([
        ["src/app.ts", "posix", "src/app.ts"],
        ["My Docs/it's.ts", "posix", "'My Docs/it'\\''s.ts'"],
        ["src\\app.ts", "powershell", "src\\app.ts"],
        ["C:\\repo\\a.ts", "cmd", "C:\\repo\\a.ts"],
        ["My Docs\\it's.ts", "powershell", "'My Docs\\it''s.ts'"],
        ["My Docs\\it’s.ts", "powershell", "'My Docs\\it’’s.ts'"],
        ["My Docs\\it's.ts", "cmd", '"My Docs\\it\'s.ts"'],
        ['say "hi"', "cmd", '"say ""hi"""'],
    ] as const)("%s (%s) → %s", (text, dialect, expected) => {
        expect(shellQuote(text, dialect)).toBe(expected);
    });
});

describe("quoteDialect", () => {
    it("quotes POSIX on a POSIX backend, and per shell on Windows", () => {
        expect(quoteDialect("posix", "pwsh")).toBe("posix");
        expect(quoteDialect("posix", undefined)).toBe("posix");
        expect(quoteDialect("windows", "pwsh")).toBe("powershell");
        expect(quoteDialect("windows", "powershell")).toBe("powershell");
        expect(quoteDialect("windows", "cmd")).toBe("cmd");
        expect(quoteDialect("windows", "bash")).toBe("posix");
        // An agent session, or a shell ref recorded before the field existed.
        expect(quoteDialect("windows", undefined)).toBe("cmd");
    });
});
