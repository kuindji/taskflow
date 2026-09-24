import { describe, expect, it } from "bun:test";
import {
    BUILTIN_ACTION_DEFAULTS,
    builtinActionFollowsDefaultAgent,
    isBuiltinActionId,
    missingPromptVariables,
    renderPromptTemplate,
} from "./builtin-actions";

describe("renderPromptTemplate", () => {
    it("substitutes known placeholders and keeps unknown ones", () => {
        expect(renderPromptTemplate("a {{x}} b {{y}}", { x: "1" })).toBe("a 1 b {{y}}");
    });

    it("never re-scans substituted text or expands $ patterns", () => {
        const diff = "+ const s = '{{diff}} $& $1 $$';";
        expect(renderPromptTemplate("D: {{diff}}", { diff })).toBe(`D: ${diff}`);
    });

    it("ignores inherited object keys", () => {
        expect(renderPromptTemplate("{{constructor}}", {})).toBe("{{constructor}}");
    });
});

describe("missingPromptVariables", () => {
    it("lists required variables absent from the template", () => {
        const vars = [
            { name: "a", description: "" },
            { name: "b", description: "" },
        ];
        expect(missingPromptVariables("x {{a}}", vars)).toEqual(["b"]);
        expect(missingPromptVariables("{{a}}{{b}}", vars)).toEqual([]);
    });
});

describe("ids", () => {
    it("recognises built-in ids only", () => {
        expect(isBuiltinActionId("builtin:commit")).toBe(true);
        expect(isBuiltinActionId("builtin:nope")).toBe(false);
        expect(isBuiltinActionId(42)).toBe(false);
    });

    it("only the commit built-in follows the default agent", () => {
        expect(builtinActionFollowsDefaultAgent("builtin:commit")).toBe(true);
        expect(builtinActionFollowsDefaultAgent("builtin:task-title")).toBe(false);
    });
});

// Regression guard: these literals are copied verbatim from the code the
// built-ins replace. The defaults must render to exactly the same prompts.
describe("defaults reproduce the pre-built-in prompts", () => {
    it("task title", () => {
        const description = "Fix the thing";
        const before = `Generate a concise task title (3-7 words) for this task description. Output ONLY the title, nothing else. No quotes, no punctuation at the end.\n\nDescription: ${description}`;
        const def = BUILTIN_ACTION_DEFAULTS["builtin:task-title"];
        expect(renderPromptTemplate(def.prompt, { description })).toBe(before);
        expect(def.sessionType).toBe("claude");
        expect(def.agentOptions).toEqual({ type: "claude", model: "haiku" });
        expect(def.mode).toBe("headless");
    });

    it("schedule name", () => {
        const prompt = "Every morning, summarise";
        const before = `Generate a concise schedule name (3-7 words) for this scheduled task prompt. Output ONLY the name, nothing else. No quotes, no punctuation at the end.\n\nPrompt: ${prompt}`;
        const def = BUILTIN_ACTION_DEFAULTS["builtin:schedule-name"];
        expect(renderPromptTemplate(def.prompt, { prompt })).toBe(before);
        expect(def.sessionType).toBe("claude");
        expect(def.agentOptions).toEqual({ type: "claude", model: "haiku" });
    });

    it("commit message", () => {
        const diff = "diff --git a/x b/x";
        const before = [
            "Generate a concise git commit message for the following changes.",
            "Output ONLY the commit message — no explanation, no markdown, no quotes.",
            "Use conventional commit format (e.g. feat:, fix:, refactor:).",
            "",
            diff,
        ].join("\n");
        const def = BUILTIN_ACTION_DEFAULTS["builtin:commit-message"];
        expect(renderPromptTemplate(def.prompt, { diff })).toBe(before);
        expect(def.sessionType).toBe("claude");
        expect(def.agentOptions).toBeUndefined();
    });

    it("commit with agent", () => {
        const instructions =
            "Create commits for staged changes only. Push to remote after committing.";
        const def = BUILTIN_ACTION_DEFAULTS["builtin:commit"];
        expect(renderPromptTemplate(def.prompt, { instructions })).toBe(instructions);
        expect(def.sessionType).toBeUndefined();
        expect(def.mode).toBe("session");
    });

    it("every default declares the placeholders its template uses", () => {
        for (const def of Object.values(BUILTIN_ACTION_DEFAULTS)) {
            expect(missingPromptVariables(def.prompt, def.variables)).toEqual([]);
        }
    });
});
