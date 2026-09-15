import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { mkdtemp, readFile, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
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
        const machines = createMachines(dir);
        // Spy on the instance method rather than mocking the shared module:
        // `createMachines` must never call `startDiscovery` itself, and this
        // proves it without touching how the real registry is constructed.
        const startDiscoverySpy = mock(machines.registry.startDiscovery);
        machines.registry.startDiscovery = startDiscoverySpy;

        await machines.registry.load();
        await machines.registry.addBackend({ host: "10.0.0.5" });

        const raw = await readFile(join(dir, "backends.json"), "utf-8");
        expect(raw).toContain("10.0.0.5");
        expect(startDiscoverySpy).not.toHaveBeenCalled();
    });
});
