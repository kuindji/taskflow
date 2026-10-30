import { assertCompatibleSnapshot, supplementalSnapshotSequence } from "@taskflow/shared";
import type {
    SessionHistoryResponse,
    SessionSnapshotResponse,
    TerminalOutputEvent,
} from "@taskflow/shared";

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
    let active: Promise<void> | null = null;
    let followUp = false;
    const pending: Array<{ data: string; sequence: number | null }> = [];

    async function replace(): Promise<void> {
        buffering = true;
        try {
            const response = await deps.requestSnapshot().catch(() => null);
            if (disposed) return;
            if (response !== null) assertCompatibleSnapshot(response);
            let data: string;
            let lastSequence: number;
            if (response?.snapshot != null) {
                data = response.snapshot + supplementalSnapshotSequence(response);
                lastSequence = response.lastSequence;
            } else {
                const history = await deps.requestHistory();
                if (disposed) return;
                data = history.data;
                lastSequence = history.lastSequence;
            }
            replaying = true;
            await deps.writer.flush();
            if (disposed) return;
            deps.reset();
            deps.writer.write(data);
            do {
                for (const chunk of pending.splice(0)) {
                    if (chunk.sequence === null || chunk.sequence > lastSequence)
                        deps.writer.write(chunk.data);
                }
                await deps.writer.flush();
                if (disposed) return;
            } while (pending.length);
            loaded = true;
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
                await replace();
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
            if (buffering) pending.push({ data: event.data, sequence: event.sequence });
            else deps.writer.write(event.data);
        },
        receiveExit(exitCode) {
            if (disposed) return;
            const data = `\r\n\x1b[90m[Process exited with code ${exitCode}]\x1b[0m\r\n`;
            if (buffering) pending.push({ data, sequence: null });
            else deps.writer.write(data);
        },
        forwardInput(data, send) {
            if (!disposed && !replaying) send(data);
        },
        dispose() {
            disposed = true;
            replaying = false;
            pending.length = 0;
        },
    };
}
