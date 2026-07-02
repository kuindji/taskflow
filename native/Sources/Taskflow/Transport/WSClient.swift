import Foundation

@MainActor
final class WSClient: NSObject, URLSessionWebSocketDelegate {
    enum WSClientError: Error, LocalizedError {
        case timeout, notConnected, badResponse, server(String)

        var errorDescription: String? {
            switch self {
            case .timeout: return "Request timed out"
            case .notConnected: return "WebSocket is not connected"
            case .badResponse: return "Bad WebSocket response"
            case let .server(message): return message
            }
        }
    }

    private let url: URL
    private var socketSession: URLSession!
    private var socketTask: URLSessionWebSocketTask?
    private var pending: [String: CheckedContinuation<Data, Error>] = [:]
    private var timeouts: [String: Swift.Task<Void, Never>] = [:]
    private var handlers: [String: [UUID: (Data) -> Void]] = [:]
    private var reconnectAttempt = 0
    private var isDisconnecting = false

    init(url: URL) { self.url = url; super.init() }

    func connect() {
        // Re-entrancy guard: never replace a live socket (a manual connect racing a
        // scheduled reconnect would leak the old task + spawn a second receiveLoop).
        // The receive-failure path nils socketTask before scheduling a reconnect, so
        // reconnection still proceeds past this guard.
        guard socketTask == nil else { return }
        isDisconnecting = false
        socketSession = URLSession(configuration: .default, delegate: self, delegateQueue: nil)
        let t = socketSession.webSocketTask(with: url)
        socketTask = t
        t.resume()
        receiveLoop()
    }

    func disconnect() {
        isDisconnecting = true
        socketTask?.cancel(with: .goingAway, reason: nil)
        socketTask = nil
        failAllPending(.notConnected)
    }

    var activeTimeoutCount: Int { timeouts.count }

    func requestRaw(
        _ type: MessageType,
        payload: [String: Any],
        correlationId: String = UUID().uuidString,
        timeoutNanoseconds: UInt64 = 30_000_000_000
    ) async throws -> Data {
        guard let text = WSCodec.encodeRequest(type: type.rawValue, correlationId: correlationId, payload: payload)
        else { throw WSClientError.badResponse }
        guard let socketTask else { throw WSClientError.notConnected }
        return try await withCheckedThrowingContinuation { cont in
            pending[correlationId] = cont
            socketTask.send(.string(text)) { [weak self] error in
                if let error { Swift.Task { @MainActor in self?.fail(correlationId, error) } }
            }
            timeouts[correlationId] = Swift.Task { @MainActor [weak self] in
                try? await Swift.Task.sleep(nanoseconds: timeoutNanoseconds)
                if !Swift.Task.isCancelled { self?.fail(correlationId, WSClientError.timeout) }
            }
        }
    }

    func request<Res: Decodable>(_ type: MessageType, payload: [String: Any]) async throws -> Res {
        let data = try await requestRaw(type, payload: payload)
        return try JSONDecoder().decode(Res.self, from: data)
    }

    func send(_ type: MessageType, payload: [String: Any]) {
        guard let text = WSCodec.encodeRequest(type: type.rawValue, correlationId: UUID().uuidString, payload: payload)
        else { return }
        socketTask?.send(.string(text)) { _ in }
    }

    @discardableResult
    func on<E: Decodable>(_ type: MessageType, _ handler: @escaping (E) -> Void) -> () -> Void {
        let id = UUID()
        handlers[type.rawValue, default: [:]][id] = { data in
            if let decoded = try? JSONDecoder().decode(E.self, from: data) { handler(decoded) }
        }
        return { [weak self] in self?.handlers[type.rawValue]?.removeValue(forKey: id) }
    }

    func handleInbound(_ inbound: WSInbound) {
        switch inbound {
        case let .response(correlationId, _, payload, error):
            timeouts.removeValue(forKey: correlationId)?.cancel()
            if let cont = pending.removeValue(forKey: correlationId) {
                if let error {
                    cont.resume(throwing: WSClientError.server(error))
                } else {
                    cont.resume(returning: payload)
                }
            }
        case let .event(type, payload):
            handlers[type]?.values.forEach { $0(payload) }
        }
    }

    func failAllPending(_ error: WSClientError) {
        for (id, cont) in pending { timeouts.removeValue(forKey: id)?.cancel(); cont.resume(throwing: error) }
        pending.removeAll()
    }

    private func fail(_ correlationId: String, _ error: Error) {
        timeouts.removeValue(forKey: correlationId)?.cancel()
        if let cont = pending.removeValue(forKey: correlationId) { cont.resume(throwing: error) }
    }

    private func receiveLoop() {
        socketTask?.receive { [weak self] result in
            guard let self else { return }
            switch result {
            case .failure:
                Swift.Task { @MainActor in
                    self.socketTask = nil  // clear the dead task so connect()'s guard lets reconnect through
                    self.failAllPending(.notConnected)
                    if !self.isDisconnecting { self.scheduleReconnect() }
                }
            case let .success(message):
                let text: String? = {
                    switch message {
                    case let .string(s): return s
                    case let .data(d): return String(data: d, encoding: .utf8)
                    @unknown default: return nil
                    }
                }()
                Swift.Task { @MainActor in
                    if let text, let inbound = WSCodec.decode(text) { self.handleInbound(inbound) }
                    self.receiveLoop()
                }
            }
        }
    }

    private func scheduleReconnect() {
        reconnectAttempt += 1
        let delay = min(pow(2.0, Double(reconnectAttempt)), 30.0)
        Swift.Task { @MainActor in
            try? await Swift.Task.sleep(nanoseconds: UInt64(delay * 1_000_000_000))
            if !self.isDisconnecting { self.connect() }
        }
    }

    nonisolated func urlSession(_ session: URLSession, webSocketTask: URLSessionWebSocketTask,
                                didOpenWithProtocol protocol: String?) {
        Swift.Task { @MainActor in self.reconnectAttempt = 0 }
    }

    func awaitNextCorrelation(
        timeoutNanoseconds: UInt64? = nil,
        _ trigger: @escaping @MainActor (String) -> Void
    ) async throws -> Data {
        let correlationId = UUID().uuidString
        return try await withCheckedThrowingContinuation { cont in
            pending[correlationId] = cont
            if let timeoutNanoseconds {
                timeouts[correlationId] = Swift.Task { @MainActor [weak self] in
                    try? await Swift.Task.sleep(nanoseconds: timeoutNanoseconds)
                    if !Swift.Task.isCancelled { self?.fail(correlationId, WSClientError.timeout) }
                }
            }
            trigger(correlationId)
        }
    }
}
