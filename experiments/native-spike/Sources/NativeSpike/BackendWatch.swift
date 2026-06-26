//
//  BackendWatch.swift
//  NativeSpike — Phase 3 / Risk 3 prototype.
//
//  Watches a *backend-owned* Taskflow session (the kind a scheduler spawns and
//  nobody is attached to) by consuming the same WebSocket byte stream the React
//  UI consumes, and feeding it into a libghostty `.inMemory` surface. This is
//  the "bring-your-own-bytes" render path — the one the viability assessment
//  flagged as the awkward seam (Risk 3).
//
//  Protocol (from packages/backend/src/ws/server.ts — upgrades on any path, no
//  auth; broadcasts reach every client):
//    • request : { correlationId, type, payload }
//    • response: { correlationId, type, payload }
//    • event   : { type, payload }              // no correlationId
//  We send `session:snapshot` for the initial screen, then render every
//  `terminal:output` whose payload.sessionId matches. Keystrokes typed into the
//  watch surface are forwarded back as `session:input`, and grid resizes as
//  `terminal:resize` — so watching is even interactive, for free.
//

import Foundation
import GhosttyTerminal

@MainActor
final class BackendWatch: NSObject, URLSessionWebSocketDelegate {
    private let apiURL: String
    private let sessionID: String
    private let session: InMemoryTerminalSession
    private var task: URLSessionWebSocketTask?
    private var socketSession: URLSession!

    init(apiURL: String, sessionID: String, session: InMemoryTerminalSession) {
        self.apiURL = apiURL
        self.sessionID = sessionID
        self.session = session
        super.init()
    }

    func start() {
        guard let wsURL = makeWebSocketURL() else {
            NSLog("BackendWatch: bad API URL \(apiURL)")
            return
        }
        socketSession = URLSession(configuration: .default, delegate: self, delegateQueue: nil)
        let task = socketSession.webSocketTask(with: wsURL)
        self.task = task
        task.resume()
        receiveLoop()
        requestSnapshot()
    }

    func stop() {
        task?.cancel(with: .goingAway, reason: nil)
    }

    /// Forward a keystroke (from the in-memory surface's write callback) to the
    /// backend PTY as session input.
    func sendInput(_ data: Data) {
        guard let text = String(data: data, encoding: .utf8) else { return }
        sendRequest(type: "session:input", payload: ["sessionId": sessionID, "data": text])
    }

    /// Forward a grid resize to the backend PTY.
    func sendResize(columns: Int, rows: Int) {
        sendRequest(
            type: "terminal:resize",
            payload: ["sessionId": sessionID, "cols": columns, "rows": rows]
        )
    }

    // MARK: - WS plumbing

    private func makeWebSocketURL() -> URL? {
        guard var comps = URLComponents(string: apiURL) else { return nil }
        comps.scheme = (comps.scheme == "https") ? "wss" : "ws"
        return comps.url
    }

    private func requestSnapshot() {
        sendRequest(
            type: "session:snapshot",
            payload: ["sessionId": sessionID],
            correlationId: "snapshot-1"
        )
    }

    private func sendRequest(
        type: String,
        payload: [String: Any],
        correlationId: String? = nil
    ) {
        var body: [String: Any] = ["type": type, "payload": payload]
        if let correlationId { body["correlationId"] = correlationId }
        guard let data = try? JSONSerialization.data(withJSONObject: body),
              let text = String(data: data, encoding: .utf8)
        else { return }
        task?.send(.string(text)) { error in
            if let error { NSLog("BackendWatch send error: \(error)") }
        }
    }

    private func receiveLoop() {
        task?.receive { [weak self] result in
            guard let self else { return }
            switch result {
            case let .failure(error):
                NSLog("BackendWatch receive error: \(error)")
            case let .success(message):
                let text: String?
                switch message {
                case let .string(s): text = s
                case let .data(d): text = String(data: d, encoding: .utf8)
                @unknown default: text = nil
                }
                if let text { Task { @MainActor in self.handle(text) } }
                Task { @MainActor in self.receiveLoop() }
            }
        }
    }

    private func handle(_ text: String) {
        guard let data = text.data(using: .utf8),
              let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let type = obj["type"] as? String,
              let payload = obj["payload"] as? [String: Any]
        else { return }

        switch type {
        case "session:snapshot":
            // Response to our snapshot request: full serialized screen.
            if let snapshot = payload["snapshot"] as? String, !snapshot.isEmpty {
                session.receive(snapshot)
            }
        case "terminal:output":
            // Live stream — only the session we're watching.
            guard payload["sessionId"] as? String == sessionID,
                  let chunk = payload["data"] as? String else { return }
            session.receive(chunk)
        default:
            break
        }
    }
}
