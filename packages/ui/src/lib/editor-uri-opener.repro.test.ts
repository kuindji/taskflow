/**
 * Plan review repro for docs/superpowers/plans/2026-08-24-taskflow-remote-projects.md
 *
 * Task 15 rebuilds Monaco model URIs as
 *     Uri.from({ scheme, authority: backendId, path: "/", fragment: absolutePath })
 * (plan lines 3209-3215) — the path deliberately fixed to "/" so nothing in a
 * filename can be reinterpreted as URI structure.
 *
 * Task 15's Files list names monaco-import-navigation.ts:134, :176, :191, :232.
 * It does not name :161, and `registerEditorOpener` appears zero times in the
 * whole plan. That opener calls `openFile(resource.path)`.
 *
 * The assertion below states the WRONG value that would reach openFile.
 * Delete this file when the opener reads pathFromModelUri instead.
 */
import { describe, expect, test } from "bun:test";
import { Uri } from "monaco-editor";

// Task 15, Step 3, verbatim.
function modelUriFor(backendId: string, absolutePath: string): Uri {
    return Uri.from({
        scheme: "taskflow-file",
        authority: backendId,
        path: "/",
        fragment: absolutePath,
    });
}

describe("Task 15 URIs and the editor opener the plan does not update", () => {
    test("Cmd-clicking an import would hand openFile the string '/'", () => {
        const resource = modelUriFor("desktop", "/Users/me/repo/src/b.ts");

        // monaco-import-navigation.ts:161-162 today:
        //     openCodeEditor(_source, resource) { openFile(resource.path); ... }
        expect(resource.path).toBe("/");

        // The real path lives in the fragment, where only pathFromModelUri looks.
        expect(resource.fragment).toBe("/Users/me/repo/src/b.ts");
    });
});
