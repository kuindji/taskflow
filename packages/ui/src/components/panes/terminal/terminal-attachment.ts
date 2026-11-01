import { assertCompatibleSnapshot, supplementalSnapshotSequence } from "@taskflow/shared";
import type {
    SessionHistoryResponse,
    SessionSnapshotResponse,
    TerminalOutputEvent,
    TerminalResyncEvent,
} from "@taskflow/shared";

export function subscribeTerminalRecovery(deps: {
    sessionId: string;
    backendId(): string | null;
    onResync(handler: (payload: TerminalResyncEvent, backendId: string) => void): () => void;
    onReady(handler: (backendId: string) => void): () => void;
    resync(): Promise<void>;
    /** Resizes made while the connection was down never reached the PTY. */
    resize(): void;
}): () => void {
    const recover = () => {
        void deps.resync().catch(() => undefined);
    };
    const offResync = deps.onResync((payload, backendId) => {
        if (backendId === deps.backendId() && payload.sessionIds.includes(deps.sessionId))
            recover();
    });
    const offReady = deps.onReady((backendId) => {
        if (backendId !== deps.backendId()) return;
        deps.resize();
        recover();
    });
    return () => {
        offResync();
        offReady();
    };
}

interface Chunk {
    data: string;
    sequence: number;
}
const RECENT_LIMIT = 128 * 1024;

export function createTerminalAttachment(deps: {
    sessionId: string;
    requestSnapshot(): Promise<SessionSnapshotResponse>;
    requestHistory(): Promise<SessionHistoryResponse>;
    writer: { write(data: string): void; flush(): Promise<void> };
    reset(): void;
    scrollToBottom(): void;
}): {
    ensureLoaded(): Promise<void>;
    resync(): Promise<void>;
    receiveOutput(event: TerminalOutputEvent): void;
    receiveExit(exitCode: number): void;
    forwardInput(data: string, send: (data: string) => void): void;
    dispose(): void;
} {
    let loaded = false;
    let buffering = true;
    let replaying = false;
    let disposed = false;
    let dirty = false;
    let active: Promise<void> | null = null;
    let followUp = false;
    let lastAccepted: number | null = null;
    let highestReceived = 0;
    let recentBytes = 0;
    const recent: Chunk[] = [];
    let pending: Chunk[] = [];
    const exits: string[] = [];

    function remember(chunk: Chunk): void {
        recent.push(chunk);
        recentBytes += chunk.data.length;
        while (recentBytes > RECENT_LIMIT && recent.length > 1) {
            const removed = recent.shift();
            if (removed) recentBytes -= removed.data.length;
        }
    }

    function catchUp(sequence: number): { chunks: Chunk[]; sequence: number; complete: boolean } {
        const numbered = new Map(pending.map((chunk) => [chunk.sequence, chunk]));
        const chunks: Chunk[] = [];
        for (const chunk of [...numbered.values()].sort((a, b) => a.sequence - b.sequence)) {
            if (chunk.sequence <= sequence) continue;
            if (chunk.sequence !== sequence + 1) break;
            chunks.push(chunk);
            sequence = chunk.sequence;
        }
        return { chunks, sequence, complete: sequence >= highestReceived };
    }

    async function replace(): Promise<void> {
        buffering = true;
        pending = [
            ...new Map([...recent, ...pending].map((chunk) => [chunk.sequence, chunk])).values(),
        ];
        dirty = true;
        try {
            const response = await deps.requestSnapshot().catch(() => null);
            if (disposed) return;
            if (response !== null) assertCompatibleSnapshot(response);
            let usedHistory = false;
            let replacement: { data: string; lastSequence: number } | null =
                response?.snapshot != null
                    ? {
                          data: response.snapshot + supplementalSnapshotSequence(response),
                          lastSequence: response.lastSequence,
                      }
                    : null;
            async function history(): Promise<void> {
                const result = await deps.requestHistory();
                if (!disposed) replacement = result;
                usedHistory = true;
            }
            if (!replacement || !catchUp(replacement.lastSequence).complete) await history();
            if (disposed || !replacement) return;
            if (!catchUp(replacement.lastSequence).complete)
                throw new Error("Terminal history does not cover the output gap");
            replaying = true;
            await deps.writer.flush();
            if (disposed) return;
            // Output can arrive while the old writer is draining. Validate again
            // before touching the good screen, using queued history if necessary.
            if (!catchUp(replacement.lastSequence).complete && !usedHistory) await history();
            if (disposed || !replacement) return;
            if (!catchUp(replacement.lastSequence).complete)
                throw new Error("Terminal history does not cover the output gap");
            deps.reset();
            deps.writer.write(replacement.data);
            let sequence = replacement.lastSequence;
            let exitCount = 0;
            while (!disposed) {
                const bridge = catchUp(sequence);
                for (const chunk of bridge.chunks) deps.writer.write(chunk.data);
                sequence = bridge.sequence;
                for (const marker of exits.slice(exitCount)) deps.writer.write(marker);
                exitCount = exits.length;
                await deps.writer.flush();
                if (disposed) return;
                lastAccepted = sequence;
                loaded = true;
                if (!catchUp(sequence).complete)
                    throw new Error("Terminal output remains discontinuous");
                if (sequence < highestReceived || exitCount < exits.length) continue;
                break;
            }
            highestReceived = Math.max(highestReceived, sequence);
            pending = [];
            dirty = false;
            buffering = false;
            deps.scrollToBottom();
        } finally {
            replaying = false;
        }
    }

    function start(): Promise<void> {
        if (disposed) return Promise.resolve();
        if (active) {
            followUp = true;
            return active;
        }
        const run = (async () => {
            do {
                followUp = false;
                try {
                    await replace();
                } catch (error) {
                    // A recovery requested meanwhile still deserves its own attempt.
                    if (!followUp || disposed) throw error;
                }
            } while (followUp && !disposed);
        })();
        active = run.finally(() => {
            active = null;
        });
        return active;
    }

    return {
        ensureLoaded() {
            return loaded ? Promise.resolve() : (active ?? start());
        },
        resync: start,
        receiveOutput(event) {
            if (disposed || event.sessionId !== deps.sessionId) return;
            if (lastAccepted !== null && event.sequence <= lastAccepted) return;
            highestReceived = Math.max(highestReceived, event.sequence);
            const chunk = { data: event.data, sequence: event.sequence };
            remember(chunk);
            if (buffering) {
                pending.push(chunk);
                if (dirty && !active) void start().catch(() => undefined);
                return;
            }
            if (lastAccepted !== null && event.sequence !== lastAccepted + 1) {
                pending.push(chunk);
                void start().catch(() => undefined);
                return;
            }
            deps.writer.write(event.data);
            lastAccepted = event.sequence;
        },
        receiveExit(exitCode) {
            if (disposed) return;
            const data = `\r\n\x1b[90m[Process exited with code ${exitCode}]\x1b[0m\r\n`;
            exits.push(data);
            if (!buffering) deps.writer.write(data);
        },
        forwardInput(data, send) {
            if (!disposed && !replaying) send(data);
        },
        dispose() {
            disposed = true;
            replaying = false;
            pending = [];
            recent.length = 0;
            exits.length = 0;
        },
    };
}
