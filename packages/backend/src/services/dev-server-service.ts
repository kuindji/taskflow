import { MSG } from "@taskflow/shared";
import type {
    DevServer,
    DevServerListResponse,
    DevServerStopResult,
    WsEvent,
} from "@taskflow/shared";
import type { DevServerInput, DevServerStore } from "./dev-server-store";
import { createProcessStopper } from "./process-stopper";
import type { StopProcess } from "./process-stopper";

const MAX_LABEL_LENGTH = 80;

class DevServerInputError extends Error {}

interface DevServerService {
    list(): Promise<DevServer[]>;
    add(input: DevServerInput): Promise<DevServer>;
    remove(id: string): Promise<boolean>;
    removeByPid(pid: number): Promise<boolean>;
    stop(id: string): Promise<DevServerStopResult>;
}

interface DevServerServiceDeps {
    store: DevServerStore;
    broadcast: (event: WsEvent) => void;
    stopProcess?: StopProcess;
}

function validate(input: DevServerInput): DevServerInput {
    if (!Number.isInteger(input.pid) || input.pid <= 0) {
        throw new DevServerInputError("Field 'pid' must be a positive integer");
    }
    const label = input.label.trim();
    if (!label) {
        throw new DevServerInputError("Field 'label' is required and must be a non-empty string");
    }
    if (label.length > MAX_LABEL_LENGTH) {
        throw new DevServerInputError(
            `Field 'label' must be at most ${MAX_LABEL_LENGTH} characters`,
        );
    }
    return { ...input, label };
}

function createDevServerService(deps: DevServerServiceDeps): DevServerService {
    const { store, broadcast } = deps;
    const stopProcess = deps.stopProcess ?? createProcessStopper();

    // The store queues this read behind every write already queued, so the
    // lists go out in mutation order and never step back.
    async function publish(): Promise<void> {
        const payload: DevServerListResponse = { devServers: await store.list() };
        broadcast({ type: MSG.DEV_SERVER_LIST, payload });
    }

    return {
        list: () => store.list(),

        async add(input) {
            const server = await store.add(validate(input));
            await publish();
            return server;
        },

        async remove(id) {
            const removed = await store.remove(id);
            if (removed) await publish();
            return removed;
        },

        async removeByPid(pid) {
            const removed = await store.removeByPid(pid);
            if (removed) await publish();
            return removed;
        },

        async stop(id) {
            const server = await store.get(id);
            if (!server) return { ok: true };
            const outcome = await stopProcess(server.pid, server.registeredAt);
            if (outcome.status === "failed") return { ok: false, error: outcome.error };
            // Not remove(id): a re-add of the pid while the stop ran keeps the id.
            if (await store.removeIfUnchanged(server)) await publish();
            return { ok: true };
        },
    };
}

export { createDevServerService, DevServerInputError };
export type { DevServerService };
