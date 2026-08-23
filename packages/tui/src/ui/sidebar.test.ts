import { describe, test, expect } from "bun:test";
import { MSG } from "@taskflow/shared";
import type { Project, Task } from "@taskflow/shared";
import { ScreenBuffer, ATTR_INVERSE } from "../render/cells";
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
});
