import { expect, test } from "bun:test";
import type { PiLaunchOptions, PiModelsResponse } from "@taskflow/shared";
import { normalizePiLaunchOptions } from "../../src/services/pi-options";
import { fetchPiModels } from "../../src/services/runtime-detector";
const context = { env: { PATH: "/probe/bin", PI_CODING_AGENT_DIR: "/home/pi" }, cwd: "/repo" };
const inventory: PiModelsResponse = {
    models: [
        {
            provider: "custom",
            id: "reasoner",
            contextWindow: "128K",
            maxOutput: "64K",
            supportsThinking: true,
            supportsImages: false,
            supportsXhigh: true,
        },
    ],
    defaultModel: "custom/reasoner",
};
test("non-xhigh Pi launch options do not start discovery", async () => {
    const options: PiLaunchOptions = { type: "pi", thinking: "high" };
    expect(
        await normalizePiLaunchOptions(options, context, async () => {
            throw Error("must not probe");
        }),
    ).toBe(options);
});
test("an explicitly supporting Pi model retains --thinking xhigh", async () => {
    for (const model of ["custom/reasoner", undefined]) {
        const options: PiLaunchOptions = { type: "pi", model, thinking: "xhigh", tools: "bash" };
        const result = await normalizePiLaunchOptions(options, context, async (actual) => {
            expect(actual).toMatchObject(context);
            return inventory;
        });
        expect(result).toEqual(options);
        expect(result).not.toBe(options);
    }
});
test("Pi discovery failure and unknown shorthand models fall back to high", async () => {
    for (const model of ["reasoner", "missing/model"]) {
        const options: PiLaunchOptions = { type: "pi", model, thinking: "xhigh", tools: "read" };
        expect(await normalizePiLaunchOptions(options, context, async () => inventory)).toEqual({
            ...options,
            thinking: "high",
        });
        expect(options.thinking).toBe("xhigh");
    }
    expect(
        (
            await normalizePiLaunchOptions({ type: "pi", thinking: "xhigh" }, context, async () => {
                throw Error("offline");
            })
        ).thinking,
    ).toBe("high");
});
test("a Pi probe slower than the launch budget falls back to high and releases the probe", async () => {
    let killed = 0,
        ended = 0,
        cancelled = 0;
    const stream = () =>
        new ReadableStream<Uint8Array>({
            cancel() {
                cancelled++;
            },
        });
    const result = await normalizePiLaunchOptions(
        { type: "pi", thinking: "xhigh" },
        context,
        (options) =>
            fetchPiModels(options, {
                resolveCli: () => "/probe/bin/pi",
                spawn: () => ({
                    stdout: stream(),
                    stderr: stream(),
                    write: async () => {},
                    end: async () => {
                        ended++;
                    },
                    kill() {
                        killed++;
                    },
                    exited: new Promise(() => {}),
                }),
            }),
        10,
    );
    expect(result.thinking).toBe("high");
    expect(killed).toBe(1);
    expect(ended).toBe(1);
    expect(cancelled).toBe(2);
});
