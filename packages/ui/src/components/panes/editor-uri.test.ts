import { describe, expect, test } from "bun:test";
import * as monaco from "monaco-editor";
import { backendFromModelUri, modelUriFor, pathFromModelUri } from "./editor-uri";

/** Monaco's model registry keys models by this string. */
const modelKey = (backendId: string, path: string) => modelUriFor(backendId, path).toString();

describe("editor model URIs", () => {
    test("the same path on two machines produces two distinct URIs", () => {
        const a = modelUriFor("laptop", "/Users/me/repo/src/a.ts");
        const b = modelUriFor("desktop", "/Users/me/repo/src/a.ts");
        expect(a.toString()).not.toBe(b.toString());
    });

    test("round-trips the path, including spaces and unicode", () => {
        const path = "/Users/me/my repo/src/café ☕.ts";
        const uri = modelUriFor("desktop", path);
        expect(pathFromModelUri(uri)).toBe(path);
        expect(backendFromModelUri(uri)).toBe("desktop");
    });

    test("round-trips a Windows-style absolute path", () => {
        const path = "C:\\Users\\me\\repo\\src\\a.ts";
        expect(pathFromModelUri(modelUriFor("desktop", path))).toBe(path);
    });

    test("survives a trip through the string key", () => {
        // TS worker file names come back as strings and are parsed into URIs,
        // so `toString` and `parse` must round-trip the fragment exactly —
        // including the characters `toString` percent-encodes.
        const path = "/Users/me/my repo/src/café #1 ☕.ts";
        const parsed = monaco.Uri.parse(modelKey("desktop", path));
        expect(pathFromModelUri(parsed)).toBe(path);
        expect(backendFromModelUri(parsed)).toBe("desktop");
    });

    test("the URI's own path is not the file path, so nothing may read it", () => {
        // Guards the registerEditorOpener site: `resource.path` is "/" for every
        // model now, and code that reads it opens the filesystem root.
        expect(modelUriFor("desktop", "/Users/me/repo/src/a.ts").path).toBe("/");
    });

    test("backend ids that differ only in case stay two models", () => {
        // Monaco's registry keys models by `toString()`, which lowercases a
        // URI authority, so a raw id would fold `Mac-Pro:1` and `mac-pro:1`.
        const path = "/Users/me/repo/src/a.ts";
        expect(modelKey("Mac-Pro:1", path)).not.toBe(modelKey("mac-pro:1", path));
        const parsed = monaco.Uri.parse(modelKey("Mac-Pro:1", path));
        expect(backendFromModelUri(parsed)).toBe("Mac-Pro:1");
    });

    test("round-trips a provisional host:instance id", () => {
        const id = "user@studio.local:2222/inst#1";
        const parsed = monaco.Uri.parse(modelKey(id, "/a.ts"));
        expect(backendFromModelUri(parsed)).toBe(id);
        expect(pathFromModelUri(parsed)).toBe("/a.ts");
    });

    test("a URI that is not a model URI names no machine", () => {
        expect(backendFromModelUri(monaco.Uri.file("/a.ts"))).toBeNull();
        expect(backendFromModelUri(monaco.Uri.parse("taskflow-file://zz/#/a.ts"))).toBeNull();
    });
});
