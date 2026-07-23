import { describe, expect, it } from "bun:test";
import {
    classifyPath,
    matchVault,
    parseVaultRegistry,
} from "../../src/services/obsidian-detector";

describe("matchVault", () => {
    it("matches a path inside a registered vault", () => {
        expect(matchVault("/w/notes/docs/wiki", ["/w/notes"])).toBe("/w/notes");
    });

    it("matches the vault root itself", () => {
        expect(matchVault("/w/notes", ["/w/notes"])).toBe("/w/notes");
    });

    it("picks the longest matching prefix", () => {
        expect(matchVault("/w/notes/docs/wiki", ["/w", "/w/notes", "/w/notes/docs"])).toBe(
            "/w/notes/docs",
        );
    });

    it("does not match a sibling with a shared prefix", () => {
        expect(matchVault("/w/notes-other/x", ["/w/notes"])).toBeNull();
    });

    it("returns null with no vaults", () => {
        expect(matchVault("/w/notes", [])).toBeNull();
    });
});

describe("classifyPath", () => {
    it("reports a registered vault", () => {
        expect(
            classifyPath({ path: "/w/notes/wiki", vaultPaths: ["/w/notes"], hasObsidianDir: true }),
        ).toBe("registered");
    });

    it("reports an unregistered folder that has .obsidian", () => {
        expect(classifyPath({ path: "/w/notes", vaultPaths: [], hasObsidianDir: true })).toBe(
            "unregistered-vault",
        );
    });

    it("reports a plain folder", () => {
        expect(classifyPath({ path: "/w/notes", vaultPaths: [], hasObsidianDir: false })).toBe(
            "plain-folder",
        );
    });
});

describe("parseVaultRegistry", () => {
    it("reads the vault paths", () => {
        const json = JSON.stringify({
            vaults: {
                abc: { path: "/w/notes", ts: 1 },
                def: { path: "/w/other", ts: 2 },
            },
        });
        expect(parseVaultRegistry(json).sort()).toEqual(["/w/notes", "/w/other"]);
    });

    it("degrades to no vaults on malformed json", () => {
        expect(parseVaultRegistry("{not json")).toEqual([]);
    });

    it("degrades to no vaults on an unexpected shape", () => {
        expect(parseVaultRegistry(JSON.stringify({ vaults: "nope" }))).toEqual([]);
        expect(parseVaultRegistry(JSON.stringify({}))).toEqual([]);
    });

    it("skips entries with no path", () => {
        const json = JSON.stringify({ vaults: { a: { ts: 1 }, b: { path: "/w/x" } } });
        expect(parseVaultRegistry(json)).toEqual(["/w/x"]);
    });
});
