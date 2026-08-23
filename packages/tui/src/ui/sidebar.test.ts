import { describe, test, expect } from "bun:test";
import { MSG } from "@taskflow/shared";
import type { Project, Task } from "@taskflow/shared";
import { ScreenBuffer, ATTR_BOLD, ATTR_INVERSE, blankCell } from "../render/cells";
import { Store } from "../state/store";
import { buildRows, drawSidebar } from "./sidebar";
import type { NetLike } from "../net/client";

function project(id: string, name: string): Project {
    return { id, name, path: `/tmp/${id}`, sessions: [], attributes: [], createdAt: "" };
}

function task(id: string, projectId: string, title: string, sessions = 0): Task {
    return {
        id,
        projectId,
        title,
        description: "",
        notes: "",
        worktree: { enabled: false, path: null, branch: null, pr: null },
        sessions: Array.from({ length: sessions }, (_, i) => ({
            id: `${id}-s${String(i)}`,
            type: "claude" as const,
            label: "claude",
            createdAt: "",
        })),
        attributes: [],
        createdAt: "",
        status: "active",
        archivedAt: null,
        pinned: false,
    };
}

function stubNet(projects: Project[], tasks: Task[]): NetLike {
    return {
        request<T>(type: string): Promise<T> {
            if (type === MSG.PROJECT_LIST) return Promise.resolve({ projects } as T);
            if (type === MSG.TASK_LIST) return Promise.resolve({ tasks } as T);
            return Promise.reject(new Error(`no stub for ${type}`));
        },
        on: () => () => undefined,
        onStatusChange: () => () => undefined,
    };
}

function rowText(buf: ScreenBuffer, y: number, width: number): string {
    let out = "";
    for (let x = 0; x < width; x++) out += buf.get(x, y).ch;
    return out.trimEnd();
}

describe("buildRows", () => {
    test("lists each project followed by its active tasks", async () => {
        const store = new Store(
            stubNet(
                [project("p1", "Alpha"), project("p2", "Beta")],
                [task("t1", "p1", "First"), task("t2", "p2", "Second")],
            ),
        );
        await store.load();
        expect(buildRows(store).map((r) => `${r.kind}:${r.label}`)).toEqual([
            "project:Alpha",
            "task:First",
            "project:Beta",
            "task:Second",
        ]);
        store.dispose();
    });

    test("carries the session count on task rows", async () => {
        const store = new Store(stubNet([project("p1", "Alpha")], [task("t1", "p1", "First", 2)]));
        await store.load();
        expect(buildRows(store)[1]?.sessionCount).toBe(2);
        store.dispose();
    });
});

describe("drawSidebar", () => {
    test("draws project and task labels", () => {
        const buf = new ScreenBuffer(20, 5);
        drawSidebar(
            buf,
            [
                { kind: "project", id: "p1", label: "Alpha", sessionCount: 0 },
                { kind: "task", id: "t1", label: "First", sessionCount: 0 },
            ],
            0,
            20,
            5,
        );
        expect(rowText(buf, 0, 20)).toContain("Alpha");
        expect(rowText(buf, 1, 20)).toContain("First");
    });

    test("marks the selected row with the inverse attribute", () => {
        const buf = new ScreenBuffer(20, 5);
        drawSidebar(
            buf,
            [
                { kind: "project", id: "p1", label: "Alpha", sessionCount: 0 },
                { kind: "task", id: "t1", label: "First", sessionCount: 0 },
            ],
            1,
            20,
            5,
        );
        expect(buf.get(0, 1).attrs & ATTR_INVERSE).toBe(ATTR_INVERSE);
        expect(buf.get(0, 0).attrs & ATTR_INVERSE).toBe(0);
    });

    test("truncates a label that exceeds the width", () => {
        const buf = new ScreenBuffer(10, 2);
        drawSidebar(
            buf,
            [{ kind: "task", id: "t1", label: "AnExtremelyLongTaskTitle", sessionCount: 0 }],
            0,
            10,
            2,
        );
        expect(rowText(buf, 0, 10).length).toBeLessThanOrEqual(10);
    });

    test("shows a session count badge when a task has sessions", () => {
        const buf = new ScreenBuffer(20, 2);
        drawSidebar(buf, [{ kind: "task", id: "t1", label: "First", sessionCount: 3 }], 0, 20, 2);
        expect(rowText(buf, 0, 20)).toContain("3");
    });

    test("indents task rows and puts the badge after the label", () => {
        const buf = new ScreenBuffer(20, 3);
        drawSidebar(
            buf,
            [
                { kind: "project", id: "p1", label: "Alpha", sessionCount: 0 },
                { kind: "task", id: "t1", label: "First", sessionCount: 3 },
            ],
            0,
            20,
            3,
        );
        expect(rowText(buf, 0, 20)).toBe("Alpha");
        expect(rowText(buf, 1, 20)).toBe("  First 3");
        expect(rowText(buf, 2, 20)).toBe("");
    });

    test("bolds project rows and leaves task rows unbolded", () => {
        const buf = new ScreenBuffer(20, 2);
        drawSidebar(
            buf,
            [
                { kind: "project", id: "p1", label: "Alpha", sessionCount: 0 },
                { kind: "task", id: "t1", label: "First", sessionCount: 0 },
            ],
            -1,
            20,
            2,
        );
        expect(buf.get(0, 0).attrs & ATTR_BOLD).toBe(ATTR_BOLD);
        expect(buf.get(19, 0).attrs & ATTR_BOLD).toBe(ATTR_BOLD);
        expect(buf.get(0, 1).attrs & ATTR_BOLD).toBe(0);
    });

    test("carries the selection attribute across the whole row, padding included", () => {
        const buf = new ScreenBuffer(20, 2);
        drawSidebar(buf, [{ kind: "task", id: "t1", label: "First", sessionCount: 0 }], 0, 20, 2);
        for (let x = 0; x < 20; x++) {
            expect(buf.get(x, 0).attrs & ATTR_INVERSE).toBe(ATTR_INVERSE);
            expect(buf.get(x, 1).attrs & ATTR_INVERSE).toBe(0);
        }
    });

    test("does not select a row past the end of the list", () => {
        const buf = new ScreenBuffer(4, 2);
        drawSidebar(buf, [], 0, 4, 2);
        expect(buf.get(0, 0).attrs).toBe(0);
        expect(buf.get(3, 1).attrs).toBe(0);
    });

    test("clears every cell left over from a previous frame", () => {
        const buf = new ScreenBuffer(8, 3);
        for (let y = 0; y < 3; y++) {
            for (let x = 0; x < 8; x++) {
                buf.set(x, y, { ...blankCell(), ch: "#", attrs: ATTR_BOLD | ATTR_INVERSE });
            }
        }
        drawSidebar(buf, [{ kind: "task", id: "t1", label: "Ab", sessionCount: 0 }], 1, 8, 3);
        expect(rowText(buf, 0, 8)).toBe("  Ab");
        expect(rowText(buf, 1, 8)).toBe("");
        expect(rowText(buf, 2, 8)).toBe("");
        for (let x = 0; x < 8; x++) {
            expect(buf.get(x, 1).attrs).toBe(0);
            expect(buf.get(x, 2).attrs).toBe(0);
        }
    });

    test("keeps a wide label glyph in one cell with a width-zero continuation", () => {
        const buf = new ScreenBuffer(6, 1);
        drawSidebar(buf, [{ kind: "project", id: "p1", label: "\u4f60A", sessionCount: 0 }], 0, 6, 1);
        expect(buf.get(0, 0).ch).toBe("\u4f60");
        expect(buf.get(0, 0).width).toBe(2);
        expect(buf.get(1, 0).width).toBe(0);
        expect(buf.get(2, 0).ch).toBe("A");
    });

    test("does not split an astral glyph across two cells", () => {
        const buf = new ScreenBuffer(6, 1);
        drawSidebar(
            buf,
            [{ kind: "task", id: "t1", label: "\u{1f680}x", sessionCount: 0 }],
            0,
            6,
            1,
        );
        expect(buf.get(2, 0).ch).toBe("\u{1f680}");
        expect(buf.get(3, 0).width).toBe(0);
        expect(buf.get(4, 0).ch).toBe("x");
    });

    test("truncates by display width so the badge always fits", () => {
        const buf = new ScreenBuffer(8, 1);
        drawSidebar(
            buf,
            [{ kind: "task", id: "t1", label: "\u4f60\u4f60\u4f60", sessionCount: 4 }],
            0,
            8,
            1,
        );
        expect(rowText(buf, 0, 8)).toBe("  \u4f60\u4f60 4");
    });
});
