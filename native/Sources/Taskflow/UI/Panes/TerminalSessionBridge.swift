import Foundation
import GhosttyTerminal

/// Owns one backend session's byte stream and feeds a libghostty .inMemory surface.
/// Port of terminal-lifecycle.ts: snapshot-first load, sequence-gated live stream.
@MainActor
final class TerminalSessionBridge {
    private let sessionId: String
    private let client: WSClient
    private let session: InMemoryTerminalSession

    private var historyLoaded = false
    private var lastSequence = 0
    private var pending: [(seq: Int, data: String)] = []
    private var unsubscribe: (() -> Void)?

    init(sessionId: String, client: WSClient, session: InMemoryTerminalSession) {
        self.sessionId = sessionId
        self.client = client
        self.session = session
    }

    /// Pure: split buffered chunks into the ordered set to apply now (seq > lastSequence)
    /// and the set to keep buffering (none, once history is loaded). Mirrors flushPendingChunks.
    nonisolated static func reconcile(pending: [(seq: Int, data: String)], lastSequence: Int)
        -> (apply: [String], keep: [(seq: Int, data: String)]) {
        let fresh = pending.filter { $0.seq > lastSequence }.sorted { $0.seq < $1.seq }
        return (fresh.map { $0.data }, [])
    }

    func start() {
        // Subscribe BEFORE requesting the snapshot so no live chunk is lost in the gap.
        unsubscribe = client.on(.terminalOutput) { [weak self] (event: TerminalOutputEvent) in
            Task { @MainActor [weak self] in
                guard let self, event.sessionId == self.sessionId else { return }
                if self.historyLoaded {
                    let seq = Int(event.sequence)
                    if seq > self.lastSequence {
                        self.session.receive(event.data)
                        self.lastSequence = seq
                    }
                } else {
                    self.pending.append((Int(event.sequence), event.data))
                }
            }
        }
        Task { @MainActor in await loadHistory() }
    }

    private func loadHistory() async {
        do {
            let snap: SessionSnapshotResponse = try await client.request(
                .sessionSnapshot, payload: ["sessionId": sessionId])
            if let snapshot = snap.snapshot {
                session.receive(snapshot)
                if snap.cursorHidden { session.receive("\u{1b}[?25l") }   // DECTCEM hide
                lastSequence = Int(snap.lastSequence)
            } else {
                let hist: SessionHistoryResponse = try await client.request(
                    .sessionHistory, payload: ["sessionId": sessionId])
                session.receive(hist.data)
                lastSequence = Int(hist.lastSequence)
            }
        } catch {
            // snapshot failed → fall back to history; if that fails, start empty (live stream continues)
            if let hist: SessionHistoryResponse = try? await client.request(
                .sessionHistory, payload: ["sessionId": sessionId]) {
                session.receive(hist.data)
                lastSequence = Int(hist.lastSequence)
            }
        }
        let r = Self.reconcile(pending: pending, lastSequence: lastSequence)
        for chunk in r.apply { session.receive(chunk) }
        if let last = pending.map({ $0.seq }).max(), last > lastSequence { lastSequence = last }
        pending = r.keep
        historyLoaded = true
    }

    func stop() { unsubscribe?(); unsubscribe = nil }
}
