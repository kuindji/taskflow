import { describe, it, expect } from "bun:test";
import {
    detectRuntimes,
    detectAgents,
    parseCodexAppServerOutput,
    parsePiModelsOutput,
    parseKimiModelsOutput,
} from "../../src/services/runtime-detector";

describe("detectRuntimes", () => {
    it("returns at least one runtime on a dev machine", async () => {
        const runtimes = await detectRuntimes();
        expect(runtimes.length).toBeGreaterThan(0);
    });

    it("detects bun when running under bun", async () => {
        const runtimes = await detectRuntimes();
        const bun = runtimes.find((r) => r.name === "bun");
        expect(bun).toBeDefined();
        expect(bun?.path).toBeTruthy();
        expect(bun?.version).not.toBe("unknown");
    });

    it("returns name, path, and version for each runtime", async () => {
        const runtimes = await detectRuntimes();
        for (const rt of runtimes) {
            expect(rt.name).toBeTruthy();
            expect(rt.path).toBeTruthy();
            expect(typeof rt.version).toBe("string");
        }
    });
});

describe("detectAgents", () => {
    it(
        "returns an entry for each known agent type",
        async () => {
            const agents = await detectAgents();
            const types = agents.map((a) => a.type);
            expect(types).toContain("claude");
            expect(types).toContain("codex");
        },
        { timeout: 15000 },
    );

    it(
        "returns correct shape for each agent",
        async () => {
            const agents = await detectAgents();
            for (const agent of agents) {
                expect(typeof agent.type).toBe("string");
                expect(typeof agent.available).toBe("boolean");
                expect(typeof agent.path).toBe("string");
                expect(typeof agent.version).toBe("string");
                if (agent.available) {
                    expect(agent.path).toBeTruthy();
                } else {
                    expect(agent.path).toBe("");
                }
            }
        },
        { timeout: 15000 },
    );
});

describe("parsePiModelsOutput", () => {
    const FIXTURE = [
        "provider      model                context  max-out  thinking  images",
        "openai-codex  gpt-5.1              272K     128K     yes       yes   ",
        "openai-codex  gpt-5.3-codex-spark  128K     128K     yes       no    ",
        "anthropic     claude-sonnet-4.5    200K     64K      no        yes   ",
    ].join("\n");

    it("parses columns into PiModelInfo objects and skips the header", () => {
        const models = parsePiModelsOutput(FIXTURE);
        expect(models).toHaveLength(3);
        expect(models[0]).toEqual({
            provider: "openai-codex",
            id: "gpt-5.1",
            contextWindow: "272K",
            maxOutput: "128K",
            supportsThinking: true,
            supportsImages: true,
        });
    });

    it("converts yes/no columns to booleans", () => {
        const models = parsePiModelsOutput(FIXTURE);
        expect(models[1].supportsThinking).toBe(true);
        expect(models[1].supportsImages).toBe(false);
        expect(models[2].supportsThinking).toBe(false);
        expect(models[2].supportsImages).toBe(true);
    });

    it("returns empty array for empty input", () => {
        expect(parsePiModelsOutput("")).toEqual([]);
        expect(parsePiModelsOutput("   \n   ")).toEqual([]);
    });

    it("returns empty array for header-only input", () => {
        expect(parsePiModelsOutput("provider  model  context  max-out  thinking  images")).toEqual(
            [],
        );
    });
});

describe("parseCodexAppServerOutput", () => {
    const FIXTURE = [
        JSON.stringify({ id: 1, result: { userAgent: "taskflow/0.1" } }),
        JSON.stringify({ method: "account/updated", params: {} }),
        JSON.stringify({
            id: 2,
            result: {
                data: [
                    {
                        id: "gpt-5.6-sol",
                        model: "gpt-5.6-sol",
                        displayName: "GPT-5.6-Sol",
                        description: "Latest frontier agentic coding model.",
                        hidden: false,
                        supportedReasoningEfforts: [
                            { reasoningEffort: "low", description: "Fast" },
                            { reasoningEffort: "high", description: "Deep" },
                        ],
                        defaultReasoningEffort: "low",
                        inputModalities: ["text", "image"],
                        isDefault: true,
                    },
                ],
                nextCursor: null,
            },
        }),
    ].join("\n");

    it("extracts normalized models from the model/list response", () => {
        expect(parseCodexAppServerOutput(FIXTURE)).toEqual([
            {
                id: "gpt-5.6-sol",
                model: "gpt-5.6-sol",
                displayName: "GPT-5.6-Sol",
                description: "Latest frontier agentic coding model.",
                hidden: false,
                supportedReasoningEfforts: [
                    { reasoningEffort: "low", description: "Fast" },
                    { reasoningEffort: "high", description: "Deep" },
                ],
                defaultReasoningEffort: "low",
                inputModalities: ["text", "image"],
                isDefault: true,
            },
        ]);
    });

    it("ignores malformed lines and unknown reasoning efforts", () => {
        const output = [
            "not json",
            JSON.stringify({
                id: 2,
                result: {
                    data: [
                        {
                            id: "future-model",
                            supportedReasoningEfforts: [
                                { reasoningEffort: "future", description: "Unknown" },
                                { reasoningEffort: "medium", description: "Supported" },
                            ],
                            defaultReasoningEffort: "future",
                        },
                    ],
                },
            }),
        ].join("\n");

        const models = parseCodexAppServerOutput(output);
        expect(models[0]?.supportedReasoningEfforts).toEqual([
            { reasoningEffort: "medium", description: "Supported" },
        ]);
        expect(models[0]?.defaultReasoningEffort).toBe("medium");
    });
});

describe("parseKimiModelsOutput", () => {
    const FIXTURE = JSON.stringify({
        providers: { "managed:kimi-code": { type: "kimi" } },
        models: {
            "kimi-code/kimi-for-coding": {
                provider: "managed:kimi-code",
                model: "kimi-for-coding",
                maxContextSize: 262144,
                capabilities: ["thinking", "tool_use"],
                displayName: "K2.7 Coding",
            },
            "kimi-code/k3": {
                provider: "managed:kimi-code",
                model: "k3",
                maxContextSize: 262144,
                displayName: "K3",
            },
        },
    });

    it("parses the models map into KimiModelInfo entries", () => {
        const models = parseKimiModelsOutput(FIXTURE);
        expect(models).toHaveLength(2);
        expect(models[0]).toEqual({
            id: "kimi-code/kimi-for-coding",
            displayName: "K2.7 Coding",
            contextWindow: "256K",
        });
        expect(models[1]).toEqual({ id: "kimi-code/k3", displayName: "K3", contextWindow: "256K" });
    });

    it("falls back to the model field, then the alias id, when displayName is missing", () => {
        const withModel = parseKimiModelsOutput(
            JSON.stringify({ models: { "kimi-code/x": { model: "x", maxContextSize: 131072 } } }),
        );
        expect(withModel).toEqual([{ id: "kimi-code/x", displayName: "x", contextWindow: "128K" }]);
        const bare = parseKimiModelsOutput(
            JSON.stringify({ models: { "kimi-code/y": { maxContextSize: 131072 } } }),
        );
        expect(bare).toEqual([{ id: "kimi-code/y", displayName: "kimi-code/y", contextWindow: "128K" }]);
    });

    it("returns empty for malformed JSON, non-object, and missing models", () => {
        expect(parseKimiModelsOutput("not json")).toEqual([]);
        expect(parseKimiModelsOutput('"str"')).toEqual([]);
        expect(parseKimiModelsOutput("{}")).toEqual([]);
        expect(parseKimiModelsOutput("")).toEqual([]);
    });

    it("omits contextWindow when maxContextSize is absent or invalid", () => {
        const models = parseKimiModelsOutput(
            JSON.stringify({ models: { "kimi-code/y": { displayName: "Y", maxContextSize: "big" } } }),
        );
        expect(models).toEqual([{ id: "kimi-code/y", displayName: "Y", contextWindow: "" }]);
    });
});
