import Foundation

@MainActor
final class WSClient: NSObject, URLSessionWebSocketDelegate {
    enum WSClientError: Error { case timeout, notConnected, badResponse }

    private let url: URL
    private var socketSession: URLSession!
    private var task: URLSessionWebSocketTask?
    private var pending: [String: CheckedContinuation<Data, Error>] = [:]
    private var handlers: [String: [UUID: (Data) -> Void]] = [:]
    private var reconnectAttempt = 0

    init(url: URL) {
        self.url = url
        super.init()
    }

    func connect() {
        socketSession = URLSession(configuration: .default, delegate: self, delegateQueue: nil)
        let task = socketSession.webSocketTask(with: url)
        self.task = task
        task.resume()
        receiveLoop()
    }

    func disconnect() {
        task?.cancel(with: .goingAway, reason: nil)
        task = nil
    }

    func request(type: String, payload: [String: Any]) async throws -> Data {
        let correlationId = UUID().uuidString
        guard let text = WSCodec.encodeRequest(type: type, correlationId: correlationId, payload: payload) else {
            throw WSClientError.badResponse
        }
        return try await withCheckedThrowingContinuation { cont in
            pending[correlationId] = cont
            task?.send(.string(text)) { [weak self] error in
                if let error { Task { @MainActor in self?.fail(correlationId, error) } }
            }
            Task { @MainActor [weak self] in
                try? await Task.sleep(nanoseconds: 30_000_000_000)
                self?.fail(correlationId, WSClientError.timeout)
            }
        }
    }

    func send(type: String, payload: [String: Any]) {
        guard let text = WSCodec.encodeRequest(type: type, correlationId: UUID().uuidString, payload: payload) else { return }
        task?.send(.string(text)) { _ in }
    }

    func on(event type: String, _ handler: @escaping (Data) -> Void) -> () -> Void {
        let id = UUID()
        handlers[type, default: [:]][id] = handler
        return { [weak self] in self?.handlers[type]?.removeValue(forKey: id) }
    }

    func handleInbound(_ inbound: WSInbound) {
        switch inbound {
        case let .response(correlationId, _, payload):
            if let cont = pending.removeValue(forKey: correlationId) { cont.resume(returning: payload) }
        case let .event(type, payload):
            handlers[type]?.values.forEach { $0(payload) }
        }
    }

    private func fail(_ correlationId: String, _ error: Error) {
        if let cont = pending.removeValue(forKey: correlationId) { cont.resume(throwing: error) }
    }

    private func receiveLoop() {
        task?.receive { [weak self] result in
            guard let self else { return }
            switch result {
            case .failure:
                Task { @MainActor in self.scheduleReconnect() }
            case let .success(message):
                let text: String? = {
                    switch message {
                    case let .string(s): return s
                    case let .data(d): return String(data: d, encoding: .utf8)
                    @unknown default: return nil
                    }
                }()
                Task { @MainActor in
                    if let text, let inbound = WSCodec.decode(text) { self.handleInbound(inbound) }
                    self.receiveLoop()
                }
            }
        }
    }

    private func scheduleReconnect() {
        reconnectAttempt += 1
        let delay = min(pow(2.0, Double(reconnectAttempt)), 30.0)
        Task { @MainActor in
            try? await Task.sleep(nanoseconds: UInt64(delay * 1_000_000_000))
            self.connect()
        }
    }

    nonisolated func urlSession(_ session: URLSession, webSocketTask: URLSessionWebSocketTask,
                               didOpenWithProtocol protocol: String?) {
        Task { @MainActor in self.reconnectAttempt = 0 }
    }

    // Test helper: run `trigger` with a fresh correlationId after registering the
    // continuation, so a test can feed the matching response synchronously.
    func awaitNextCorrelation(_ trigger: @escaping @MainActor (String) -> Void) async throws -> Data {
        let correlationId = UUID().uuidString
        return try await withCheckedThrowingContinuation { cont in
            pending[correlationId] = cont
            trigger(correlationId)
        }
    }
}
