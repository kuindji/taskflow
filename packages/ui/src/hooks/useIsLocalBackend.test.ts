import { describe, expect, test } from "bun:test";
import type { MachineState } from "@/stores/backend-store";
import { isLocalBackend } from "./useIsLocalBackend";

function machine(id: string, isLocal: boolean): MachineState {
    return {
        id,
        displayName: id,
        host: isLocal ? "localhost" : `${id}.lan`,
        instanceId: "main",
        state: "attached",
        isLocal,
        keepAttached: true,
    };
}

describe("isLocalBackend", () => {
    const machines = [machine("local", true), machine("desktop", false)];

    test("a remote machine's backend is not local", () => {
        expect(isLocalBackend(machines, "desktop")).toBe(false);
        expect(isLocalBackend(machines, "local")).toBe(true);
    });

    test("no backend is never local", () => {
        expect(isLocalBackend(machines, null)).toBe(false);
    });

    test("a backend with no row is not local while machines are listed", () => {
        expect(isLocalBackend(machines, "gone")).toBe(false);
    });

    test("with no machine rows (the dev renderer) the one backend is local", () => {
        expect(isLocalBackend([], "local")).toBe(true);
    });
});
