import { describe, it, expect } from "bun:test";
import {
    detectRuntimes,
    detectAgents,
    parsePiModelsOutput,
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

    it("returns correct shape for each agent", async () => {
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
    });
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
