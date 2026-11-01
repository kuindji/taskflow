import { describe, expect, it } from "bun:test";
import type { ActionDefinition } from "@taskflow/shared";
import type { Scoped } from "@/lib/backend-scope";
import { scheduleActionOptions } from "./schedule-helpers";

function action(id: string, standalone: boolean): Scoped<ActionDefinition> {
    return {
        id,
        backendId: "b1",
        name: id,
        prompt: "p",
        sessionType: "claude",
        standalone: standalone || undefined,
        createdAt: "",
        updatedAt: "",
    };
}

describe("scheduleActionOptions", () => {
    const actions = [action("run-menu", true), action("hidden", false)];

    it("offers only standalone actions to a new schedule", () => {
        expect(scheduleActionOptions(actions, "p1", "b1", undefined).map((a) => a.id)).toEqual([
            "run-menu",
        ]);
    });

    it("keeps the schedule's own action after it stops being standalone", () => {
        // Clearing it would make saving any edit send actionId: null.
        expect(scheduleActionOptions(actions, "p1", "b1", "hidden").map((a) => a.id)).toEqual([
            "run-menu",
            "hidden",
        ]);
    });

    it("offers nothing before the project's machine is known", () => {
        expect(scheduleActionOptions(actions, "p1", undefined, "hidden")).toEqual([]);
    });
});
