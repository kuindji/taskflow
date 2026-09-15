import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { mkdtemp, readFile, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { createRegistry, createTunnelManager } from "@taskflow/shared/remote";
import { createMachines } from "./machines";

let dir: string;

beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "taskflow-tui-machines-"));
});

afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
});

describe("createMachines", () => {
    it("wires a registry that persists to backends.json without starting discovery", async () => {
        const startDiscoverySpy = mock(() => Promise.resolve());
        const machines = createMachines(dir, {
            createTunnelManager,
            // The spy is installed on the registry object *before*
            // `createMachines` ever sees it, so a `startDiscovery()` call
            // made during construction — not just afterward — fails this
            // test, not only one made by a caller later.
            createRegistry: (deps: Parameters<typeof createRegistry>[0]) => {
                const registry = createRegistry(deps);
                registry.startDiscovery = startDiscoverySpy;
                return registry;
            },
        });

        await machines.registry.load();
        await machines.registry.addBackend({ host: "10.0.0.5" });

        const raw = await readFile(join(dir, "backends.json"), "utf-8");
        expect(raw).toContain("10.0.0.5");
        expect(startDiscoverySpy).not.toHaveBeenCalled();
    });
});
