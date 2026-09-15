import { mkdirSync } from "fs";
import { userInfo } from "os";
import { join } from "path";
import {
    createRegistry,
    createTunnelManager,
    type BackendRegistry,
    type TunnelManager,
} from "@taskflow/shared/remote";

/** The id of this machine's own backend, as opposed to a saved remote record. */
const LOCAL_MACHINE_ID = "local";

interface Machines {
    registry: BackendRegistry;
    tunnels: TunnelManager;
}

/**
 * Wires the shared remote registry and tunnel manager for the TUI, mirroring
 * how `electron/src/main.ts` builds them for the desktop app. Does not call
 * `registry.init()` (and so never starts discovery): callers decide when the
 * listener socket should open.
 */
function createMachines(stateDir: string): Machines {
    mkdirSync(stateDir, { recursive: true, mode: 0o700 });

    const tunnels = createTunnelManager();
    const registry = createRegistry({
        file: join(stateDir, "backends.json"),
        defaultUser: userInfo().username,
        openTunnel: tunnels.openTunnel,
        closeTunnel: tunnels.closeTunnel,
        rekeyTunnel: tunnels.rekeyTunnel,
        readRemotePort: tunnels.readRemotePort,
        fetchHostKeyFingerprint: tunnels.fetchHostKeyFingerprint,
        trustHostKey: tunnels.trustHostKey,
        forgetScannedHostKey: tunnels.forgetScannedHostKey,
    });

    return { registry, tunnels };
}

export { createMachines, LOCAL_MACHINE_ID };
export type { Machines };
