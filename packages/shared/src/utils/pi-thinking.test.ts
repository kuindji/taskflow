import { expect, test } from "bun:test";
import { supportsPiXhigh, normalizePiThinkingLevel } from "./pi-thinking";

test("xhigh requires reasoning and an explicit non-null thinkingLevelMap entry", () => {
    for (const xhigh of ["high", 0, false, ""]) {
        expect(supportsPiXhigh({ reasoning: true, thinkingLevelMap: { xhigh } })).toBe(true);
    }
});
test("missing, null, malformed and non-reasoning metadata do not advertise xhigh", () => {
    for (const model of [
        null,
        [],
        {},
        { reasoning: true },
        { reasoning: true, thinkingLevelMap: [] },
        { reasoning: true, thinkingLevelMap: "xhigh" },
        { reasoning: true, thinkingLevelMap: { xhigh: null } },
        { reasoning: false, thinkingLevelMap: { xhigh: "high" } },
        { reasoning: "yes", thinkingLevelMap: { xhigh: 1 } },
    ]) {
        expect(supportsPiXhigh(model)).toBe(false);
    }
});
test("unsupported xhigh normalizes to high and all other levels pass through", () => {
    expect(normalizePiThinkingLevel("xhigh", false)).toBe("high");
    expect(normalizePiThinkingLevel("xhigh", true)).toBe("xhigh");
    for (const level of ["off", "minimal", "low", "medium", "high"] as const) {
        expect(normalizePiThinkingLevel(level, false)).toBe(level);
    }
});
