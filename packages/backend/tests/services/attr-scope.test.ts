import { describe, expect, test } from "bun:test";
import { decideAttrScope } from "../../src/services/attr-scope";

describe("decideAttrScope", () => {
    test("explicit --task-id wins", () => {
        const result = decideAttrScope("T1", "", "", "");
        expect(result).toEqual({ ok: true, scope: { collection: "tasks", ownerId: "T1" } });
    });

    test("explicit --project-id wins", () => {
        const result = decideAttrScope("", "P1", "", "");
        expect(result).toEqual({ ok: true, scope: { collection: "projects", ownerId: "P1" } });
    });

    test("--task-id beats an inherited TASKFLOW_PROJECT_ID", () => {
        const result = decideAttrScope("T1", "", "", "P-env");
        expect(result).toEqual({ ok: true, scope: { collection: "tasks", ownerId: "T1" } });
    });

    test("--project-id beats an inherited TASKFLOW_TASK_ID", () => {
        const result = decideAttrScope("", "P1", "T-env", "");
        expect(result).toEqual({ ok: true, scope: { collection: "projects", ownerId: "P1" } });
    });

    test("env TASKFLOW_TASK_ID beats env TASKFLOW_PROJECT_ID", () => {
        const result = decideAttrScope("", "", "T-env", "P-env");
        expect(result).toEqual({ ok: true, scope: { collection: "tasks", ownerId: "T-env" } });
    });

    test("both explicit flags is an error", () => {
        const result = decideAttrScope("T1", "P1", "", "");
        expect(result).toEqual({ ok: false, error: "both-flags" });
    });

    test("nothing available is an error", () => {
        const result = decideAttrScope("", "", "", "");
        expect(result).toEqual({ ok: false, error: "no-scope" });
    });
});
