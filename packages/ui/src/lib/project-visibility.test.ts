import { describe, expect, it } from "bun:test";
import type { Project } from "@taskflow/shared";
import { activeProjects, selectableProjectId, selectableProjects } from "./project-visibility";

function project(id: string, hidden = false): Project {
    return {
        id,
        name: id,
        path: `/tmp/${id}`,
        sessions: [],
        attributes: [],
        createdAt: "2026-08-31T00:00:00.000Z",
        hidden,
    };
}

describe("project visibility", () => {
    const projects = [project("active"), project("archived", true)];

    it("omits archived projects from active project lists", () => {
        expect(activeProjects(projects).map((item) => item.id)).toEqual(["active"]);
    });

    it("keeps referenced archived projects in selectors", () => {
        expect(selectableProjects(projects, ["archived"]).map((item) => item.id)).toEqual([
            "active",
            "archived",
        ]);
        expect(selectableProjects(projects).map((item) => item.id)).toEqual(["active"]);
    });

    it("does not use an archived project as a new-record default", () => {
        expect(selectableProjectId(projects, "active")).toBe("active");
        expect(selectableProjectId(projects, "archived")).toBeUndefined();
    });
});
