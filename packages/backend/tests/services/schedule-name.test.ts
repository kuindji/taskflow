import { expect, it } from "bun:test";
import { createScheduleNameGenerator } from "../../src/services/schedule-name";

it("uses the built-in's answer with surrounding quotes stripped", async () => {
    const seen: unknown[] = [];
    const generate = createScheduleNameGenerator({
        builtinActionRunner: {
            runHeadless: async (id, vars, context) => {
                seen.push({ id, vars, context });
                return '"Morning summary"';
            },
        },
    });
    expect(await generate("Every morning, summarise")).toBe("Morning summary");
    expect(seen).toEqual([
        {
            id: "builtin:schedule-name",
            vars: { prompt: "Every morning, summarise" },
            context: { project: null },
        },
    ]);
});

it("falls back to the truncated prompt when the run fails", async () => {
    const generate = createScheduleNameGenerator({
        builtinActionRunner: {
            runHeadless: async () => {
                throw new Error("boom");
            },
        },
    });
    expect(await generate("x".repeat(80))).toBe("x".repeat(50));
    expect(await generate("   ")).toBe("Unnamed schedule");
});
