import type { TunnelFailure } from "@taskflow/shared";
import type * as BackendStoreModule from "./backend-store";

type Bridge = NonNullable<Window["taskflow"]>;
type AttachResult = Awaited<ReturnType<Bridge["attachBackend"]>>;

/** The backend-store tests' stand-in for main; each test sets what main answers. */
interface FakeMain {
    attachBackend: (id: string) => Promise<AttachResult>;
    confirmBackend: Bridge["confirmBackend"];
    detachBackend: Bridge["detachBackend"];
    detached: string[];
    confirmed: string[];
    refreshBackendToken: Bridge["refreshBackendToken"];
    refreshed: string[];
}

export function tunnelFailure(message: string): TunnelFailure {
    return { kind: "unknown", message, stderr: "" };
}

export const main: FakeMain = {
    attachBackend: () => Promise.resolve({ ok: false, failure: tunnelFailure("unset") }),
    confirmBackend: () => Promise.reject(new Error("unset")),
    detachBackend: () => Promise.resolve(),
    detached: [],
    confirmed: [],
    refreshed: [],
    refreshBackendToken: async () => ({ ok: true }),
};

let remoteResume: () => void = () => {};
let backendSeen: (id: string) => void = () => {};
let backendDropped: (id: string, failure: TunnelFailure) => void = () => {};

/**
 * One bridge for the whole run. `backend-store` subscribes to main's events
 * once, on its first import, against whatever `window.taskflow` is then — so
 * every test file driving the store must install this same object, or the
 * files that import it second never receive a drop or a beacon.
 */
export const bridge: Pick<
    Bridge,
    | "refreshBackendToken"
    | "attachBackend"
    | "confirmBackend"
    | "detachBackend"
    | "listBackends"
    | "getAttached"
    | "onBackendsChanged"
    | "onBackendDropped"
    | "onBackendSeen"
    | "onRemoteResume"
    | "sendTrayState"
> = {
    // Session state reports the tray on import; the bootstrap's flow store pulls it in.
    sendTrayState: () => {},
    refreshBackendToken: (id) => {
        main.refreshed.push(id);
        return main.refreshBackendToken(id);
    },
    attachBackend: (id) => main.attachBackend(id),
    confirmBackend: (id, info) => {
        main.confirmed.push(id);
        return main.confirmBackend(id, info);
    },
    detachBackend: (id) => {
        main.detached.push(id);
        return main.detachBackend(id);
    },
    listBackends: () => Promise.resolve([]),
    getAttached: () => Promise.resolve([]),
    onBackendsChanged: () => () => {},
    onBackendDropped: (handler) => {
        backendDropped = handler;
        return () => {
            if (backendDropped === handler) backendDropped = () => {};
        };
    },
    onRemoteResume: (handler) => {
        remoteResume = handler;
        return () => {
            if (remoteResume === handler) remoteResume = () => {};
        };
    },
    onBackendSeen: (handler) => {
        backendSeen = handler;
        return () => {
            if (backendSeen === handler) backendSeen = () => {};
        };
    },
};

export function emitBackendDropped(id: string, failure: TunnelFailure): void {
    backendDropped(id, failure);
}

export function emitRemoteResume(): void {
    remoteResume();
}

export function emitBackendSeen(id: string): void {
    backendSeen(id);
}

let previousBridge: Window["taskflow"];
let loadedStore: typeof BackendStoreModule | undefined;

/** Install the bridge and load the store against it; undo with `uninstallFakeBridge`. */
export async function installFakeBridge(): Promise<typeof BackendStoreModule> {
    previousBridge = window.taskflow;
    window.taskflow = bridge as Bridge;
    loadedStore = await import("./backend-store");
    return loadedStore;
}

/** Later test files must not run against this bridge: it lacks most of the API. */
export function uninstallFakeBridge(): void {
    window.taskflow = previousBridge;
}

/** Main refuses everything again and nothing is recorded. */
export function resetFakeMain(): Promise<void> {
    let detaches: Promise<unknown>[] = [];
    if (loadedStore) {
        const store = loadedStore.useBackendStore;
        detaches = store.getState().machines.map((m) => store.getState().detach(m.id));
        store.setState({ machines: [], primaryId: null });
    }
    main.attachBackend = () => Promise.resolve({ ok: false, failure: tunnelFailure("unset") });
    main.confirmBackend = () => Promise.reject(new Error("unset"));
    main.detachBackend = () => Promise.resolve();
    main.detached = [];
    main.confirmed = [];
    main.refreshed = [];
    main.refreshBackendToken = async () => ({ ok: true });
    return Promise.allSettled(detaches).then(() => {});
}
