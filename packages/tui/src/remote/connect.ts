import { MSG, PROTOCOL_VERSION } from "@taskflow/shared";
import type { SystemInfo, TunnelFailure } from "@taskflow/shared";
import type { BackendRegistry } from "@taskflow/shared/remote";
import { WsClient } from "../net/client";
import type { NetLike } from "../net/client";

type RegistryPort = Pick<BackendRegistry, "attachBackend" | "detachBackend" | "confirmBackend">;

/**
 * What `connectMachine` needs from a client, and what a caller gets back on
 * success: the `NetLike` surface for the workspace, plus `retarget` and `close`
 * for whoever owns the connection's lifetime. `WsClient` satisfies it.
 */
interface MachineClient extends NetLike {
    connect(): Promise<void>;
    retarget(port: number, host: string | null): void;
    close(): void;
}

type ConnectOutcome =
    | { ok: true; machineId: string; net: MachineClient }
    | { ok: false; machineId: string; failure: TunnelFailure }
    | { ok: false; machineId: string; incompatible: true }
    | { ok: false; machineId: string; alreadyAttached: true };

interface ConnectDeps {
    createClient?: (port: number, host: string) => MachineClient;
}

function defaultCreateClient(port: number, host: string): MachineClient {
    return new WsClient(port, host);
}

/** The registry's origin is `http://127.0.0.1:<local tunnel port>`. */
function parseOrigin(origin: string): { port: number; host: string } {
    const url = new URL(origin);
    const port = Number(url.port);
    if (!Number.isInteger(port) || port <= 0) {
        throw new Error(`Tunnel origin has no port: ${origin}`);
    }
    return { port, host: url.hostname };
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

/**
 * Attach a saved machine through the shared registry, dial its tunnel and
 * handshake. Mirrors the desktop renderer's `backend-store` attach flow. Never
 * throws: once the attach succeeded, every later failure closes the client and
 * detaches, so no tunnel or origin outlives a failed connect.
 */
async function connectMachine(
    machines: { registry: RegistryPort },
    id: string,
    deps: ConnectDeps = {},
): Promise<ConnectOutcome> {
    const { registry } = machines;
    const createClient = deps.createClient ?? defaultCreateClient;

    const attached = await registry.attachBackend(id);
    if (!attached.ok) return { ok: false, machineId: id, failure: attached.failure };

    let client: MachineClient | null = null;
    try {
        const target = parseOrigin(attached.origin);
        client = createClient(target.port, target.host);
        await client.connect();
        const info = await client.request<SystemInfo>(MSG.SYSTEM_INFO);

        // The registry has no socket, so the version check is only ever
        // enforced by whoever dials.
        if (info.protocolVersion !== PROTOCOL_VERSION) {
            client.close();
            await registry.detachBackend(id);
            return { ok: false, machineId: id, incompatible: true };
        }

        // Like the renderer: a backend that reports no uid keeps its record id.
        if (!info.backendUid) return { ok: true, machineId: id, net: client };

        const confirmed = await registry.confirmBackend(id, {
            backendUid: info.backendUid,
            protocolVersion: info.protocolVersion,
        });
        if (confirmed.merged) {
            // The registry already closed this alias's tunnel. Detaching the
            // canonical id would kill the live one, so only the socket goes.
            client.close();
            return { ok: false, machineId: confirmed.id, alreadyAttached: true };
        }
        return { ok: true, machineId: confirmed.id, net: client };
    } catch (error) {
        client?.close();
        try {
            await registry.detachBackend(id);
        } catch {
            // Detach only persists and closes; its failure must not turn a
            // reported connect failure into a throw.
        }
        return {
            ok: false,
            machineId: id,
            failure: { kind: "unknown", message: errorMessage(error), stderr: "" },
        };
    }
}

export { connectMachine };
export type { ConnectOutcome, MachineClient, RegistryPort };
