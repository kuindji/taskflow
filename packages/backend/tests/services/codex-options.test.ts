import { expect, it } from "bun:test";
import type { CodexLaunchOptions, CodexModelInfo, CodexModelsResponse } from "@taskflow/shared";
import { normalizeCodexLaunchOptions } from "../../src/services/codex-options";

function model(id: string, efforts: CodexModelInfo["defaultReasoningEffort"][], isDefault = false) {
    return {
        id,
        model: id,
        displayName: id,
        description: "",
        hidden: false,
        supportedReasoningEfforts: efforts.map((reasoningEffort) => ({
            reasoningEffort,
            description: "",
        })),
        defaultReasoningEffort: efforts[0] ?? "medium",
        inputModalities: ["text"],
        isDefault,
    } satisfies CodexModelInfo;
}

const inventory: CodexModelsResponse = {
    models: [model("cli", ["high", "xhigh"], true), model("small", ["low"])],
    account: { state: "unknown" },
};

function normalize(resolved: CodexLaunchOptions, explicit: CodexLaunchOptions | undefined) {
    let probes = 0;
    const result = normalizeCodexLaunchOptions(
        resolved,
        explicit,
        () => ({}),
        async () => {
            probes++;
            return inventory;
        },
    );
    return result.then((options) => ({ options, probes }));
}

it("a pinned model gets its own default for an inherited effort it cannot run", async () => {
    const { options } = await normalize(
        { type: "codex", model: "small", reasoningEffort: "xhigh" },
        { type: "codex", model: "small" },
    );
    expect(options.reasoningEffort).toBe("low");
});

it("a pinned effort is checked against the inherited model, or the CLI default model", async () => {
    const { options } = await normalize(
        { type: "codex", model: "small", reasoningEffort: "xhigh" },
        { type: "codex", reasoningEffort: "xhigh" },
    );
    expect(options.reasoningEffort).toBe("low");

    const cli = await normalize(
        { type: "codex", reasoningEffort: "xhigh" },
        { type: "codex", reasoningEffort: "xhigh" },
    );
    expect(cli.options.reasoningEffort).toBe("xhigh");
});

it("leaves whole pairs alone without probing", async () => {
    const chosen = await normalize(
        { type: "codex", model: "small", reasoningEffort: "xhigh" },
        { type: "codex", model: "small", reasoningEffort: "xhigh" },
    );
    expect(chosen).toEqual({
        options: { type: "codex", model: "small", reasoningEffort: "xhigh" },
        probes: 0,
    });
    const inherited = await normalize(
        { type: "codex", model: "small", reasoningEffort: "xhigh" },
        undefined,
    );
    expect(inherited.probes).toBe(0);
});

it("keeps the launch as is when discovery fails or the model is unknown", async () => {
    const failed = await normalizeCodexLaunchOptions(
        { type: "codex", model: "small", reasoningEffort: "xhigh" },
        { type: "codex", model: "small" },
        () => ({}),
        async () => {
            throw new Error("offline");
        },
    );
    expect(failed.reasoningEffort).toBe("xhigh");
    const unknown = await normalize(
        { type: "codex", model: "custom", reasoningEffort: "xhigh" },
        { type: "codex", model: "custom" },
    );
    expect(unknown.options.reasoningEffort).toBe("xhigh");
});

it("stops a probe that outlives the launch budget", async () => {
    let probeSignal: AbortSignal | undefined;
    const options = await normalizeCodexLaunchOptions(
        { type: "codex", model: "small", reasoningEffort: "xhigh" },
        { type: "codex", model: "small" },
        () => ({}),
        (_env, _deps, signal) => {
            probeSignal = signal;
            return new Promise(() => {});
        },
        10,
    );
    expect(options.reasoningEffort).toBe("xhigh");
    expect(probeSignal?.aborted).toBe(true);
});
