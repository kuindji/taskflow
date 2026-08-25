import { afterEach, describe, expect, test } from "bun:test";
import { KeyEvent } from "@opentui/core";
import { createTestRenderer } from "@opentui/core/testing";
import type { GitStatusResult } from "@taskflow/shared";
import { GitChanges } from "./git-changes";

function key(name: string, sequence = name): KeyEvent {
    return new KeyEvent({
        name,
        sequence,
        raw: sequence,
        eventType: "press",
        source: "raw",
        ctrl: false,
        meta: false,
        shift: sequence !== sequence.toLowerCase(),
        option: false,
        number: false,
    });
}

const status: GitStatusResult = {
    branch: "feature",
    ahead: 1,
    behind: 2,
    stagedFiles: [{ path: "partial.ts", status: "modified", staged: true }],
    unstagedFiles: [
        { path: "partial.ts", status: "modified", staged: false },
        { path: "asset.bin", status: "untracked", staged: false },
    ],
};

describe("GitChanges", () => {
    const cleanups: Array<() => void> = [];
    afterEach(() => {
        for (const cleanup of cleanups.splice(0)) cleanup();
    });

    test("renders staged and unstaged groups with a readable narrow diff", async () => {
        const test = await createTestRenderer({ width: 46, height: 16 });
        const selected: string[] = [];
        const view = new GitChanges({
            renderer: test.renderer,
            status,
            diff: { key: "staged:partial.ts", path: "partial.ts", staged: true, text: "@@ -1 +1 @@\n-old line\n+new line" },
            onSelect: (change) => selected.push(change.key),
            onStage: () => undefined,
            onUnstage: () => undefined,
            onStageAll: () => undefined,
            onUnstageAll: () => undefined,
            onCommit: () => undefined,
            onClose: () => undefined,
        });
        test.renderer.root.add(view.renderable);
        cleanups.push(() => view.destroy(), () => test.renderer.destroy());
        await test.renderOnce();
        const frame = test.captureCharFrame();
        expect(frame).toContain("Staged");
        expect(frame).toContain("Unstaged");
        expect(frame).toContain("old line");
        expect(selected).toEqual([]);

        view.update(status, {
            key: "unstaged:asset.bin",
            path: "asset.bin",
            staged: false,
            text: null,
        });
        view.handleKey(key("down"));
        view.handleKey(key("down"));
        view.update(status, {
            key: "unstaged:asset.bin",
            path: "asset.bin",
            staged: false,
            text: null,
        });
        await test.renderOnce();
        expect(test.captureCharFrame()).toContain("may be binary");
    });

    test("routes file and all-file mutations and suppresses repeated keys while pending", async () => {
        const test = await createTestRenderer({ width: 80, height: 20 });
        const calls: string[] = [];
        const view = new GitChanges({
            renderer: test.renderer,
            status,
            diff: null,
            onSelect: () => undefined,
            onStage: () => calls.push("stage"),
            onUnstage: () => {
                calls.push("unstage");
                view.setPending(true);
            },
            onStageAll: () => calls.push("stage-all"),
            onUnstageAll: () => calls.push("unstage-all"),
            onCommit: () => calls.push("commit"),
            onClose: () => calls.push("close"),
        });
        test.renderer.root.add(view.renderable);
        cleanups.push(() => view.destroy(), () => test.renderer.destroy());
        view.handleKey(key("u"));
        view.handleKey(key("u"));
        expect(calls).toEqual(["unstage"]);
        view.update(status, null);
        view.handleKey(key("s", "S"));
        view.handleKey(key("u", "U"));
        view.handleKey(key("c"));
        view.handleKey(key("escape", "\x1b"));
        expect(calls).toEqual(["unstage", "stage-all", "unstage-all", "commit", "close"]);
    });
});
