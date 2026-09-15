import { describe, expect, it } from "bun:test";
import { MSG, PROTOCOL_VERSION } from "@taskflow/shared";
import type { SystemInfo, TunnelFailure } from "@taskflow/shared";
import { connectMachine } from "./connect";
import type { MachineClient, RegistryPort } from "./connect";

const ORIGIN_PORT = 45123;

function systemInfo(overrides: Partial<SystemInfo> = {}): SystemInfo {
    return {
        editors: [],
        homedir: "/home/remote",
        schedulerEnabled: false,
        hostname: "remote",
        protocolVersion: PROTOCOL_VERSION,
        backendUid: "uid-1",
        ...overrides,
    };
}

class FakeClient implements MachineClient {
    closeCount = 0;
    readonly requests: string[] = [];
    connectError: Error | null = null;
    requestError: Error | null = null;
    info: SystemInfo = systemInfo();

    constructor(
        readonly port: number,
        readonly host: string,
    ) {}

    connect(): Promise<void> {
        return this.connectError ? Promise.reject(this.connectError) : Promise.resolve();
    }

    request<T>(type: string): Promise<T> {
        this.requests.push(type);
        if (this.requestError) return Promise.reject(this.requestError);
        // The fake only answers the handshake; anything else is a test bug.
        if (type !== MSG.SYSTEM_INFO) return Promise.reject(new Error(`unexpected ${type}`));
        return Promise.resolve(this.info as T);
    }

    on(): () => void {
        return () => {};
    }

    onStatusChange(): () => void {
        return () => {};
    }

    retarget(): void {}

    closeError: Error | null = null;

    close(): void {
        this.closeCount++;
        if (this.closeError) throw this.closeError;
    }
}

interface Harness {
    registry: RegistryPort;
    clients: FakeClient[];
    detached: string[];
    confirmed: { id: string; info: { backendUid: string; protocolVersion: number } }[];
    createClient: (port: number, host: string) => FakeClient;
}

function harness(
    options: {
        attach?: RegistryPort["attachBackend"];
        detach?: RegistryPort["detachBackend"];
        confirm?: RegistryPort["confirmBackend"];
        setup?: (client: FakeClient) => void;
    } = {},
): Harness {
    const clients: FakeClient[] = [];
    const detached: string[] = [];
    const confirmed: Harness["confirmed"] = [];
    const registry: RegistryPort = {
        attachBackend:
            options.attach ??
            (() => Promise.resolve({ ok: true, origin: `http://127.0.0.1:${ORIGIN_PORT}` })),
        detachBackend: (id) => {
            detached.push(id);
            return options.detach ? options.detach(id) : Promise.resolve();
        },
        confirmBackend: (id, info) => {
            confirmed.push({ id, info });
            return options.confirm
                ? options.confirm(id, info)
                : Promise.resolve({ id: info.backendUid, merged: false });
        },
    };
    const createClient = (port: number, host: string): FakeClient => {
        const client = new FakeClient(port, host);
        options.setup?.(client);
        clients.push(client);
        return client;
    };
    return { registry, clients, detached, confirmed, createClient };
}

describe("connectMachine", () => {
    it("dials the attached origin and returns the confirmed id", async () => {
        const h = harness();
        const outcome = await connectMachine({ registry: h.registry }, "host:inst", {
            createClient: h.createClient,
        });

        expect(outcome.ok).toBe(true);
        expect(outcome.machineId).toBe("uid-1");
        if (outcome.ok) expect(outcome.net).toBe(h.clients[0]);
        expect(h.clients).toHaveLength(1);
        expect(h.clients[0]?.port).toBe(ORIGIN_PORT);
        expect(h.clients[0]?.host).toBe("127.0.0.1");
        expect(h.clients[0]?.closeCount).toBe(0);
        expect(h.confirmed).toEqual([
            {
                id: "host:inst",
                info: { backendUid: "uid-1", protocolVersion: PROTOCOL_VERSION },
            },
        ]);
        expect(h.detached).toEqual([]);
    });

    it("returns an attach failure unchanged without creating a client", async () => {
        const failure: TunnelFailure = {
            kind: "auth-refused",
            message: "Permission denied",
            stderr: "Permission denied (publickey).",
        };
        const h = harness({ attach: () => Promise.resolve({ ok: false, failure }) });
        const outcome = await connectMachine({ registry: h.registry }, "m1", {
            createClient: h.createClient,
        });

        expect(outcome).toEqual({ ok: false, machineId: "m1", failure });
        expect(h.clients).toHaveLength(0);
        expect(h.detached).toEqual([]);
    });

    it("refuses a protocol mismatch as incompatible and detaches", async () => {
        const h = harness({
            setup: (client) => {
                client.info = systemInfo({ protocolVersion: PROTOCOL_VERSION + 1 });
            },
        });
        const outcome = await connectMachine({ registry: h.registry }, "m1", {
            createClient: h.createClient,
        });

        expect(outcome).toEqual({ ok: false, machineId: "m1", incompatible: true });
        expect(h.clients[0]?.closeCount).toBe(1);
        expect(h.detached).toEqual(["m1"]);
        expect(h.confirmed).toEqual([]);
    });

    it("turns a rejected connect into a failure, detaching once", async () => {
        const h = harness({
            setup: (client) => {
                client.connectError = new Error("WebSocket connection error");
            },
        });
        const outcome = await connectMachine({ registry: h.registry }, "m1", {
            createClient: h.createClient,
        });

        expect(outcome).toEqual({
            ok: false,
            machineId: "m1",
            failure: { kind: "unknown", message: "WebSocket connection error", stderr: "" },
        });
        expect(h.clients[0]?.closeCount).toBe(1);
        expect(h.detached).toEqual(["m1"]);
    });

    it("turns a rejected SYSTEM_INFO request into a failure, closing and detaching once", async () => {
        const h = harness({
            setup: (client) => {
                client.requestError = new Error("Request timed out: system:info");
            },
        });
        const outcome = await connectMachine({ registry: h.registry }, "m1", {
            createClient: h.createClient,
        });

        expect(outcome).toEqual({
            ok: false,
            machineId: "m1",
            failure: { kind: "unknown", message: "Request timed out: system:info", stderr: "" },
        });
        expect(h.clients[0]?.requests).toEqual([MSG.SYSTEM_INFO]);
        expect(h.clients[0]?.closeCount).toBe(1);
        expect(h.detached).toEqual(["m1"]);
    });

    it("reports a merge as alreadyAttached without detaching the canonical id", async () => {
        const h = harness({ confirm: () => Promise.resolve({ id: "uid-1", merged: true }) });
        const outcome = await connectMachine({ registry: h.registry }, "alias", {
            createClient: h.createClient,
        });

        expect(outcome).toEqual({ ok: false, machineId: "uid-1", alreadyAttached: true });
        expect(h.clients[0]?.closeCount).toBe(1);
        expect(h.detached).toEqual([]);
    });

    it("turns a thrown confirmBackend into a failure, closing and detaching", async () => {
        const h = harness({
            confirm: () => Promise.reject(new Error("answered as a different backend")),
        });
        const outcome = await connectMachine({ registry: h.registry }, "m1", {
            createClient: h.createClient,
        });

        expect(outcome).toEqual({
            ok: false,
            machineId: "m1",
            failure: { kind: "unknown", message: "answered as a different backend", stderr: "" },
        });
        expect(h.clients[0]?.closeCount).toBe(1);
        expect(h.detached).toEqual(["m1"]);
    });

    it("turns an unparsable origin into a failure and detaches without a client", async () => {
        const h = harness({
            attach: () => Promise.resolve({ ok: true, origin: "not a url" }),
        });
        const outcome = await connectMachine({ registry: h.registry }, "m1", {
            createClient: h.createClient,
        });

        expect(outcome.ok).toBe(false);
        expect("failure" in outcome && outcome.failure.kind).toBe("unknown");
        expect(h.clients).toHaveLength(0);
        expect(h.detached).toEqual(["m1"]);
    });

    it("turns a rejected attachBackend into a failure and detaches once without a client", async () => {
        // The registry records the origin before it persists, so a persist
        // failure leaves an attached origin behind that only a detach clears.
        const h = harness({ attach: () => Promise.reject(new Error("EACCES: backends.json")) });
        const outcome = await connectMachine({ registry: h.registry }, "m1", {
            createClient: h.createClient,
        });

        expect(outcome).toEqual({
            ok: false,
            machineId: "m1",
            failure: { kind: "unknown", message: "EACCES: backends.json", stderr: "" },
        });
        expect(h.clients).toHaveLength(0);
        expect(h.detached).toEqual(["m1"]);
    });

    it("still returns the attach rejection when the cleanup detach also rejects", async () => {
        const h = harness({
            attach: () => Promise.reject(new Error("EACCES: backends.json")),
            detach: () => Promise.reject(new Error("detach failed")),
        });
        const outcome = await connectMachine({ registry: h.registry }, "m1", {
            createClient: h.createClient,
        });

        expect(outcome).toEqual({
            ok: false,
            machineId: "m1",
            failure: { kind: "unknown", message: "EACCES: backends.json", stderr: "" },
        });
        expect(h.detached).toEqual(["m1"]);
    });

    it("returns the original connect failure when the cleanup detach and close both throw", async () => {
        const h = harness({
            detach: () => Promise.reject(new Error("detach failed")),
            setup: (client) => {
                client.connectError = new Error("WebSocket connection error");
                client.closeError = new Error("close failed");
            },
        });
        const outcome = await connectMachine({ registry: h.registry }, "m1", {
            createClient: h.createClient,
        });

        expect(outcome).toEqual({
            ok: false,
            machineId: "m1",
            failure: { kind: "unknown", message: "WebSocket connection error", stderr: "" },
        });
        expect(h.clients[0]?.closeCount).toBe(1);
        expect(h.detached).toEqual(["m1"]);
    });

    it("still reports incompatible when the cleanup detach rejects", async () => {
        const h = harness({
            detach: () => Promise.reject(new Error("detach failed")),
            setup: (client) => {
                client.info = systemInfo({ protocolVersion: PROTOCOL_VERSION + 1 });
            },
        });
        const outcome = await connectMachine({ registry: h.registry }, "m1", {
            createClient: h.createClient,
        });

        expect(outcome).toEqual({ ok: false, machineId: "m1", incompatible: true });
        expect(h.detached).toEqual(["m1"]);
    });

    it("still reports alreadyAttached, without detaching, when closing the surplus client throws", async () => {
        const h = harness({
            confirm: () => Promise.resolve({ id: "uid-1", merged: true }),
            setup: (client) => {
                client.closeError = new Error("close failed");
            },
        });
        const outcome = await connectMachine({ registry: h.registry }, "alias", {
            createClient: h.createClient,
        });

        expect(outcome).toEqual({ ok: false, machineId: "uid-1", alreadyAttached: true });
        expect(h.detached).toEqual([]);
    });

    it("keeps the requested id when the backend reports no uid", async () => {
        const h = harness({
            setup: (client) => {
                client.info = systemInfo({ backendUid: undefined });
            },
        });
        const outcome = await connectMachine({ registry: h.registry }, "m1", {
            createClient: h.createClient,
        });

        expect(outcome.ok).toBe(true);
        expect(outcome.machineId).toBe("m1");
        expect(h.confirmed).toEqual([]);
        expect(h.detached).toEqual([]);
    });
});
