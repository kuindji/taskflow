import { createReconnectPolicy } from "@taskflow/shared/remote/reconnect-policy";

/** One retry owner per desired remote, including across provisional-id renames. */
export function createBackendReconnects(deps: {
    isWanted(id: string): boolean;
    attempt(id: string): Promise<string | null>;
    schedule?: (run: () => void, delayMs: number) => () => void;
    random?: () => number;
}): {
    lost(id: string): void;
    setConnected(id: string, connected: boolean): void;
    retryNow(id?: string): void;
    rekey(fromId: string, toId: string): void;
    remove(id: string): void;
    dispose(): void;
} {
    type Entry = { id: string; policy: ReturnType<typeof createReconnectPolicy> };
    const entries = new Map<string, Entry>();
    let disposed = false;
    function remove(id: string) {
        entries.get(id)?.policy.stop();
        entries.delete(id);
    }
    function rekey(fromId: string, toId: string) {
        if (fromId === toId) return;
        const entry = entries.get(fromId);
        if (!entry) return;
        if (entries.has(toId)) {
            remove(fromId);
            return;
        }
        entries.delete(fromId);
        entry.id = toId;
        entries.set(toId, entry);
    }
    function ensure(id: string): Entry | undefined {
        if (disposed || !deps.isWanted(id)) return;
        const existing = entries.get(id);
        if (existing) return existing;
        const entry: Entry = {
            id,
            policy: createReconnectPolicy({
                schedule: deps.schedule,
                random: deps.random,
                async attempt() {
                    if (!deps.isWanted(entry.id)) {
                        remove(entry.id);
                        return false;
                    }
                    const canonical = await deps.attempt(entry.id);
                    if (entries.get(entry.id) !== entry || !deps.isWanted(entry.id)) return false;
                    if (canonical === null) return false;
                    rekey(entry.id, canonical);
                    return true;
                },
            }),
        };
        entries.set(id, entry);
        return entry;
    }
    return {
        lost(id) {
            const entry = ensure(id);
            entry?.policy.setConnected(false);
            entry?.policy.start();
        },
        setConnected(id, connected) {
            ensure(id)?.policy.setConnected(connected);
        },
        retryNow(id) {
            const targets = id === undefined ? [...entries.values()] : [entries.get(id)];
            for (const entry of targets) {
                if (!entry) continue;
                if (!deps.isWanted(entry.id)) remove(entry.id);
                else entry.policy.retryNow();
            }
        },
        rekey,
        remove,
        dispose() {
            disposed = true;
            for (const id of entries.keys()) remove(id);
        },
    };
}
