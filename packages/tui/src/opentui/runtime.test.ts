import { describe, expect, it } from "bun:test";
import { TextRenderable } from "@opentui/core";
import { createTestRenderer } from "@opentui/core/testing";
import type { CliRendererConfig } from "@opentui/core";
import { OpenTuiRuntimeOwner, type OwnedRenderer } from "./runtime";

type TestRenderer = Awaited<ReturnType<typeof createTestRenderer>>;

function requireSetup(setup: TestRenderer | null): TestRenderer {
    if (setup === null) throw new Error("renderer setup was not captured");
    return setup;
}

describe("OpenTUI runtime", () => {
    it("renders and resizes in memory, then destroys idempotently", async () => {
        let setup: TestRenderer | null = null;
        const owner = new OpenTuiRuntimeOwner({
            createRenderer: async (config) => {
                setup = await createTestRenderer({ ...config, width: 12, height: 2 });
                return setup.renderer;
            },
        });
        const renderer = await owner.create();
        const current = requireSetup(setup);
        renderer.root.add(new TextRenderable(renderer, { content: "taskflow" }));
        await current.renderOnce();
        expect(current.captureCharFrame()).toContain("taskflow");

        current.resize(20, 3);
        await current.renderOnce();
        expect(renderer.terminalWidth).toBe(20);
        expect(renderer.terminalHeight).toBe(3);

        await Promise.all([owner.shutdown(), owner.shutdown()]);
        expect(renderer.isDestroyed).toBe(true);
    });

    it("uses flag 1 only and keeps bare mouse motion disabled", async () => {
        const captured: { config?: CliRendererConfig } = {};
        const owner = new OpenTuiRuntimeOwner({
            env: { TASKFLOW_TUI_NO_MOUSE: "1" },
            createRenderer: async (config) => {
                captured.config = config;
                config.onDestroy?.();
                return { destroy() {}, isDestroyed: true } as OwnedRenderer;
            },
        });
        await owner.create();
        expect(captured.config?.exitOnCtrlC).toBe(false);
        expect(captured.config?.exitSignals).toEqual([]);
        expect(captured.config?.enableMouseMovement).toBe(false);
        expect(captured.config?.useMouse).toBe(false);
        expect(captured.config?.useKittyKeyboard).toEqual({
            disambiguate: true,
            alternateKeys: false,
            events: false,
            allKeysAsEscapes: false,
            reportText: false,
        });
        await owner.shutdown();
    });

    it("waits for deferred renderer destruction before closing owned resources", async () => {
        const order: string[] = [];
        let config: CliRendererConfig | null = null;
        const owner = new OpenTuiRuntimeOwner({
            createRenderer: async (value) => {
                config = value;
                return {
                    isDestroyed: false,
                    destroy: () => order.push("destroy"),
                } as OwnedRenderer;
            },
        });
        owner.ownSocket({ close: () => order.push("socket") });
        owner.ownBackend({ stop: () => order.push("backend") });
        await owner.create();
        const completeDestroy = () => config?.onDestroy?.();

        const shutdown = owner.shutdown();
        await Promise.resolve();
        expect(order).toEqual(["destroy"]);
        completeDestroy();
        await shutdown;
        expect(order).toEqual(["destroy", "socket", "backend"]);
    });
});
