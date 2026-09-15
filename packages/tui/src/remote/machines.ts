import { mkdirSync } from "fs";
import { userInfo } from "os";
import { join } from "path";
import {
    createRegistry as defaultCreateRegistry,
    createTunnelManager as defaultCreateTunnelManager,
    type BackendRegistry,
    type TunnelManager,
} from "@taskflow/shared/remote";

/** The id of this machine's own backend, as opposed to a saved remote record. */
const LOCAL_MACHINE_ID = "local";

interface Machines {
    registry: BackendRegistry;
    tunnels: TunnelManager;
}

/** Test seam: lets a test wrap the real factories (e.g. to spy on the
 *  registry they produce) without mocking the `@taskflow/shared/remote`
 *  module. Not exported: callers construct one structurally if they need it. */
interface MachineFactories {
    createRegistry: typeof defaultCreateRegistry;
    createTunnelManager: typeof defaultCreateTunnelManager;
}

const defaultFactories: MachineFactories = {
    createRegistry: defaultCreateRegistry,
    createTunnelManager: defaultCreateTunnelManager,
};

/**
 * Wires the shared remote registry and tunnel manager for the TUI, mirroring
 * how `electron/src/main.ts` builds them for the desktop app. Does not call
 * `registry.init()` (and so never starts discovery): callers decide when the
 * listener socket should open.
 */
function createMachines(
    stateDir: string,
    factories: MachineFactories = defaultFactories,
): Machines {
    mkdirSync(stateDir, { recursive: true, mode: 0o700 });

    const tunnels = factories.createTunnelManager();
    const registry = factories.createRegistry({
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
