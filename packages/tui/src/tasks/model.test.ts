import { describe, expect, test } from "bun:test";
import type { Project, Task } from "@taskflow/shared";
import {
    ownAttributeDelete,
    ownAttributeUpdate,
    repositoryPathForOwner,
    resolvedTaskAttributes,
    taskForOwner,
} from "./model";

const project: Project = {
    id: "p1",
    name: "Project",
    path: "/repo",
    sessions: [],
    attributes: [{ id: "project-env", name: "env", value: "project" }],
    createdAt: "",
};
const parent: Task = {
    id: "parent",
    projectId: "p1",
    title: "Parent",
    description: "",
    notes: "",
    worktree: { enabled: true, path: "/worktree", branch: "task", pr: null },
    sessions: [],
    attributes: [
        { id: "parent-env", name: "env", value: "parent" },
        { id: "parent-region", name: "region", value: "west" },
    ],
    createdAt: "",
    status: "active",
    archivedAt: null,
    pinned: false,
};
const child: Task = {
    ...parent,
    id: "child",
    parentId: "parent",
    title: "Child",
    attributes: [{ id: "task-region", name: "region", value: "east" }],
};
const source = { projects: [project], tasks: [parent, child] };

describe("task detail model", () => {
    test("resolves owners to tasks and repository paths", () => {
        expect(taskForOwner({ kind: "task", taskId: "parent", projectId: "p1" }, source)).toBe(
            parent,
        );
        expect(repositoryPathForOwner({ kind: "master" }, source)).toBeNull();
        expect(repositoryPathForOwner({ kind: "project", projectId: "p1" }, source)).toBe(
            "/repo",
        );
        expect(
            repositoryPathForOwner(
                { kind: "task", taskId: "parent", projectId: "p1" },
                source,
            ),
        ).toBe("/worktree");
        const withoutWorktree = {
            projects: [project],
            tasks: [{ ...parent, worktree: { ...parent.worktree, path: null } }],
        };
        expect(
            repositoryPathForOwner(
                { kind: "task", taskId: "parent", projectId: "p1" },
                withoutWorktree,
            ),
        ).toBe("/repo");
    });

    test("labels resolved attribute scope and only mutates own attributes", () => {
        const attributes = resolvedTaskAttributes(child, source);
        expect(attributes.map(({ name, value, scope }) => ({ name, value, scope }))).toEqual([
            { name: "env", value: "parent", scope: "parent" },
            { name: "region", value: "east", scope: "task" },
        ]);
        expect(ownAttributeUpdate(child, attributes[0]!, { value: "no" })).toBeNull();
        expect(ownAttributeDelete(child, attributes[0]!)).toBeNull();
        expect(ownAttributeUpdate(child, attributes[1]!, { value: "north" })).toEqual({
            taskId: "child",
            attrId: "task-region",
            value: "north",
        });
        expect(ownAttributeDelete(child, attributes[1]!)).toEqual({
            taskId: "child",
            attrId: "task-region",
        });
    });
});
