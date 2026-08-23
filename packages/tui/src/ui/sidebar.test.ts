import { describe, test, expect } from "bun:test";
import { MSG } from "@taskflow/shared";
import type { Project, Task } from "@taskflow/shared";
import { ScreenBuffer, ATTR_BOLD, ATTR_INVERSE, blankCell } from "../render/cells";
import { Store } from "../state/store";
import { buildRows, drawSidebar } from "./sidebar";
import type { NetLike } from "../net/client";

function project(id: string, name: string, sessions = 0): Project {
    return {
        id,
        name,
        path: `/tmp/${id}`,
        sessions: Array.from({ length: sessions }, (_, i) => ({
            id: `${id}-s${String(i)}`,
            type: "claude" as const,
            label: "claude",
            createdAt: "",
        })),
        attributes: [],
        createdAt: "",
    };
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

    test("carries the session count on project rows too", async () => {
        // A project runs sessions of its own, not only through its tasks. Read
        // from the task list instead, and a project row silently loses its badge.
        const store = new Store(
            stubNet([project("p1", "Alpha", 3)], [task("t1", "p1", "First", 2)]),
        );
        await store.load();
        expect(buildRows(store)[0]?.sessionCount).toBe(3);
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

    test("never draws a session count clipped to a smaller number", () => {
        // `layoutText` clips from the right, so a badge appended after the label
        // is the first thing lost. Cut short, " 12" reads as one session when
        // the task has twelve.
        const buf = new ScreenBuffer(4, 1);
        drawSidebar(buf, [{ kind: "task", id: "t1", label: "A", sessionCount: 12 }], 0, 4, 1);
        expect(rowText(buf, 0, 4)).toBe("A 12");
    });

    test("drops a badge that cannot fit rather than drawing a wrong count", () => {
        // Asserted whole, not as an absence of "1": dropping the badge must cost
        // the count and nothing else. Blanking the row would also hide the digit.
        const buf = new ScreenBuffer(2, 1);
        drawSidebar(buf, [{ kind: "task", id: "t1", label: "A", sessionCount: 12 }], 0, 2, 1);
        expect(rowText(buf, 0, 2)).toBe("A");
    });

    test("never spends the last column on indentation instead of the label", () => {
        // The indent used to be kept whenever it fit alongside the badge, which
        // could leave the label nothing at all — so a wider pane showed less:
        // `A 12` at width 4, `   12` at width 5.
        const row = { kind: "task" as const, id: "t1", label: "A", sessionCount: 12 };
        const drawn = (width: number): string => {
            const buf = new ScreenBuffer(width, 1);
            drawSidebar(buf, [row], 0, width, 1);
            return rowText(buf, 0, width);
        };
        expect(drawn(4)).toBe("A 12");
        expect(drawn(5)).toBe("A 12");
        expect(drawn(6)).toBe("  A 12");
    });

    test("drops the indent when the column it leaves cannot hold a wide glyph", () => {
        // One column survives the indent, but the label's first glyph needs two,
        // so keeping the indent would draw a row with no label in it at all.
        const buf = new ScreenBuffer(3, 1);
        drawSidebar(buf, [{ kind: "task", id: "t1", label: "漢字", sessionCount: 0 }], 0, 3, 1);
        expect(rowText(buf, 0, 3)).toBe("漢");
    });

    test("does not spend the label's columns on a control character", () => {
        // `layoutText` draws an unprintable cluster as a blank. Counted as a
        // column here, it displaces the printable text behind it and the row
        // renders empty.
        const buf = new ScreenBuffer(5, 1);
        drawSidebar(buf, [{ kind: "task", id: "t1", label: "\r\nA", sessionCount: 1 }], 0, 5, 1);
        expect(rowText(buf, 0, 5)).toBe("  A 1");
    });

    test("keeps a task label rather than a bare indent in a two-column pane", () => {
        const buf = new ScreenBuffer(2, 1);
        drawSidebar(buf, [{ kind: "task", id: "t1", label: "Ab", sessionCount: 0 }], 0, 2, 1);
        expect(rowText(buf, 0, 2)).toBe("Ab");
    });

    test("drops the indent when the label fits beside it as nothing but blanks", () => {
        // A title that starts with a space fits as a space, which `fitToWidth`
        // returns as a non-empty string but the row draws as nothing. Ranking
        // the indent below that emptied the row: ` A` at width 2, blank at 3.
        const row = { kind: "task" as const, id: "t1", label: " A", sessionCount: 0 };
        const drawn = (width: number): string => {
            const buf = new ScreenBuffer(width, 1);
            drawSidebar(buf, [row], 0, width, 1);
            return rowText(buf, 0, width);
        };
        expect(drawn(2)).toBe(" A");
        expect(drawn(3)).toBe(" A");
        expect(drawn(4)).toBe("   A");
    });

    test("keeps a blank-fitting label visible beside its badge too", () => {
        const row = { kind: "task" as const, id: "t1", label: " A", sessionCount: 1 };
        const drawn = (width: number): string => {
            const buf = new ScreenBuffer(width, 1);
            drawSidebar(buf, [row], 0, width, 1);
            return rowText(buf, 0, width);
        };
        expect(drawn(4)).toBe(" A 1");
        expect(drawn(5)).toBe(" A 1");
    });

    test("draws the whole badge when it exactly fills the pane", () => {
        // `badge.length <= width` is the boundary: one column narrower and the
        // count would have to go, one wider and the label joins it.
        const buf = new ScreenBuffer(3, 1);
        drawSidebar(buf, [{ kind: "task", id: "t1", label: "A", sessionCount: 12 }], 0, 3, 1);
        expect(rowText(buf, 0, 3)).toBe(" 12");
    });

    test("draws the session count badge on a project row", () => {
        const buf = new ScreenBuffer(20, 1);
        drawSidebar(buf, [{ kind: "project", id: "p1", label: "Alpha", sessionCount: 3 }], 0, 20, 1);
        expect(rowText(buf, 0, 20)).toBe("Alpha 3");
    });

    test("reserves two cells for an emoji presentation sequence in a label", () => {
        // U+26A0 U+FE0F advances two columns in the terminal; measured as one,
        // every glyph after it lands a column left of its cell and the row runs
        // past the pane.
        const buf = new ScreenBuffer(6, 1);
        drawSidebar(
            buf,
            [{ kind: "project", id: "p1", label: "\u26a0\ufe0fA", sessionCount: 0 }],
            0,
            6,
            1,
        );
        expect(buf.get(0, 0).width).toBe(2);
        expect(buf.get(2, 0).ch).toBe("A");
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

    test("reserves two cells for a wide symbol outside the CJK blocks", () => {
        // U+2630 is East Asian Wide, so a terminal advances two columns for it.
        // Laid out as one cell, every glyph after it sits one column left of
        // where the sidebar drew it and the row spills into the session pane.
        const buf = new ScreenBuffer(6, 1);
        drawSidebar(
            buf,
            [{ kind: "project", id: "p1", label: "\u2630A", sessionCount: 0 }],
            0,
            6,
            1,
        );
        expect(buf.get(0, 0).ch).toBe("\u2630");
        expect(buf.get(0, 0).width).toBe(2);
        expect(buf.get(1, 0).width).toBe(0);
        expect(buf.get(2, 0).ch).toBe("A");
    });

    test("does not let a leading combining mark ride on the task indentation", () => {
        // `Mn` marks bind backwards, so a label starting with one attaches to
        // the second space of the indent once the row is concatenated, and the
        // sidebar draws an accent into a cell the label does not own.
        const buf = new ScreenBuffer(6, 1);
        drawSidebar(
            buf,
            [{ kind: "task", id: "t1", label: "\u0301A", sessionCount: 1 }],
            0,
            6,
            1,
        );
        expect(buf.get(1, 0).ch).toBe(" ");
        expect(rowText(buf, 0, 6)).toBe("  A 1");
    });

    test("does not let a leading spacing mark ride on the task indentation", () => {
        // `Mc` marks bind to the cluster in front of them, so a label starting
        // with one attaches to the second space of the indent once the row is
        // concatenated, and the sidebar draws a mark into a cell the label does
        // not own.
        const buf = new ScreenBuffer(8, 1);
        drawSidebar(
            buf,
            [{ kind: "task", id: "t1", label: "\u093eA", sessionCount: 0 }],
            0,
            8,
            1,
        );
        expect(buf.get(1, 0).ch).toBe(" ");
        expect(rowText(buf, 0, 8)).toBe("  A");
    });

    test("draws a title that begins with a format character binding forwards", () => {
        // U+0600 ARABIC NUMBER SIGN prefixes the digits that follow it, so the
        // digits are the row's real text. Dropping the whole cluster left the
        // row blank and the task unidentifiable.
        const buf = new ScreenBuffer(10, 1);
        drawSidebar(
            buf,
            [{ kind: "task", id: "t1", label: "؀١٢٣", sessionCount: 0 }],
            0,
            10,
            1,
        );
        expect(rowText(buf, 0, 10)).toBe("  ؀١٢٣");
    });
});
