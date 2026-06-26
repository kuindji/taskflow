# Phase 1 — UI Vertical-Slice Spike Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build one thin native macOS vertical slice — app shell + live task sidebar + a tabbed-split workspace hosting a libghostty terminal pane AND a native code-editor pane, driven by a real Swift WS store — to produce the GO/NO-GO signal for the full native rewrite.

**Architecture:** A fresh SwiftPM executable target `experiments/native-slice/` (leaving the Phase 0 `native-spike/` intact as evidence). It vendors the same prebuilt `libghostty-spm` xcframework (pinned exact) and one native-editor dependency (`CodeEditSourceEditor`, pinned exact). A generic `WSClient` (correlationId RPC + `onEvent` broadcasts + reconnect) lifted from the proven `BackendWatch.swift` transport seam feeds an `ObservableObject` `TaskStore`. SwiftUI renders an `HSplitView` shell; the terminal pane reuses the proven `.exec` libghostty path wrapped in `NSViewRepresentable`.

**Tech Stack:** Swift 5.9 / SwiftUI + AppKit, macOS 13+, SwiftPM. Dependencies: `libghostty-spm` (GhosttyTerminal product, prebuilt GhosttyKit.xcframework), `CodeEditSourceEditor`. Backend is the existing Bun sidecar over WS (unchanged). Tests: XCTest.

## Global Constraints

- **Platform:** macOS 13+ only (decision D1). No Windows.
- **Backend untouched (D2):** the slice only *consumes* the existing WS API; do not modify `packages/backend` or the `taskflow-cli` protocol.
- **WS wire protocol (verified, from `packages/backend/src/ws/server.ts` + `packages/shared/src/constants.ts`):** upgrades on any path, **no auth**; broadcasts reach every client. Three envelope shapes:
  - request : `{ correlationId, type, payload }`
  - response: `{ correlationId, type, payload }`
  - event   : `{ type, payload }` (no correlationId)
- **Wire message names (exact strings):** `task:list` (request → `{ tasks: [...] }`), `task:created` (event), `task:updated` (event), `session:snapshot`, `terminal:output`, `session:input`, `terminal:resize`.
- **Backend URL:** read `TASKFLOW_API_URL` from the environment (the app is launched from inside a Taskflow session, so it is present); fall back to `http://localhost:63074`. `http`→`ws`, `https`→`wss`.
- **Dependency posture:** both community deps are pre-production — pin **exact** versions, never floating ranges (this is dependency-risk-retirement unit 1.1 + 1.2).
- **Spike discipline:** this is a throwaway-quality de-risking slice, NOT production parity. No feature breadth beyond what each task names. The deliverable is the Task 9 GO/NO-GO writeup.
- **Project rule:** do not add `Co-authored-by` trailers to commits.

---

### Task 1: Slice package scaffold + pinned dependencies (units 1.1, 1.2)

Stand up the SwiftPM app that vendors both community deps at pinned-exact versions and launches an empty window. This is the dependency-risk-retirement task: if either prebuilt dep fails to resolve/link, the whole slice is blocked and we learn it here.

**Files:**
- Create: `experiments/native-slice/Package.swift`
- Create: `experiments/native-slice/.gitignore`
- Create: `experiments/native-slice/Sources/NativeSlice/main.swift`
- Create: `experiments/native-slice/Sources/NativeSlice/App.swift`

**Interfaces:**
- Consumes: nothing (entry point).
- Produces: a runnable `NativeSlice` executable; a SwiftUI `SliceApp` `App` struct; the `GhosttyTerminal` and `CodeEditSourceEditor` products linked and importable by later tasks.

- [ ] **Step 1: Write `Package.swift` with exact-pinned deps**

```swift
// swift-tools-version:5.9
import PackageDescription

let package = Package(
    name: "NativeSlice",
    platforms: [.macOS(.v13)],
    dependencies: [
        // 1.1 — community fork shipping the prebuilt GhosttyKit.xcframework +
        // the HOST_MANAGED .inMemory backend patch. Pinned EXACT (not a range).
        .package(url: "https://github.com/Lakr233/libghostty-spm.git", exact: "1.2.7"),
        // 1.2 — native code editor (CodeEdit project): SwiftUI + AppKit,
        // tree-sitter highlighting, find/replace, built-in text diff. Pre-production → pin exact.
        .package(url: "https://github.com/CodeEditApp/CodeEditSourceEditor.git", exact: "0.11.2"),
    ],
    targets: [
        .executableTarget(
            name: "NativeSlice",
            dependencies: [
                .product(name: "GhosttyTerminal", package: "libghostty-spm"),
                .product(name: "CodeEditSourceEditor", package: "CodeEditSourceEditor"),
            ],
            path: "Sources/NativeSlice"
        ),
        .testTarget(
            name: "NativeSliceTests",
            dependencies: ["NativeSlice"],
            path: "Tests/NativeSliceTests"
        ),
    ]
)
```

> If `swift package resolve` reports `0.11.2` does not exist, run `git ls-remote --tags https://github.com/CodeEditApp/CodeEditSourceEditor.git`, pick the latest published tag, and record the chosen exact version in the Task 9 writeup. The constraint is "pinned exact," not this specific number.

- [ ] **Step 2: Write `.gitignore`**

```
.build/
*.xcodeproj
.DS_Store
```

- [ ] **Step 3: Write `App.swift` — empty SwiftUI shell**

```swift
import SwiftUI

struct SliceApp: App {
    var body: some Scene {
        WindowGroup("Taskflow Native Slice") {
            Text("Native slice — scaffold")
                .frame(minWidth: 1100, minHeight: 720)
        }
    }
}
```

- [ ] **Step 4: Write `main.swift` — explicit entry point**

```swift
import AppKit

let app = NSApplication.shared
app.setActivationPolicy(.regular)
SliceApp.main()
```

- [ ] **Step 5: Resolve and build**

Run: `cd experiments/native-slice && swift package resolve && swift build`
Expected: resolution prints both `libghostty-spm 1.2.7` and `CodeEditSourceEditor` at the pinned tag; build succeeds with no link errors.

- [ ] **Step 6: Launch and confirm a window appears**

Run: `cd experiments/native-slice && ./.build/debug/NativeSlice`
Expected: a window titled "Taskflow Native Slice" opens showing "Native slice — scaffold". Close it to exit.

- [ ] **Step 7: Commit**

```bash
git add experiments/native-slice/Package.swift experiments/native-slice/Package.resolved experiments/native-slice/.gitignore experiments/native-slice/Sources/NativeSlice/main.swift experiments/native-slice/Sources/NativeSlice/App.swift
git commit -m "spike(slice): scaffold native-slice with exact-pinned libghostty + CodeEditSourceEditor"
```

---

### Task 2: WS envelope codec (pure, TDD)

Encode outgoing requests and decode incoming response/event envelopes. Pure value logic — full TDD. Payloads stay as raw `Data` (JSON) so the codec is decoupled from message-specific structs and the type is `Equatable` for assertions.

**Files:**
- Create: `experiments/native-slice/Sources/NativeSlice/Transport/WSCodec.swift`
- Test: `experiments/native-slice/Tests/NativeSliceTests/WSCodecTests.swift`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `enum WSInbound: Equatable { case response(correlationId: String, type: String, payload: Data); case event(type: String, payload: Data) }`
  - `enum WSCodec { static func encodeRequest(type: String, correlationId: String, payload: [String: Any]) -> String?; static func decode(_ text: String) -> WSInbound? }`

- [ ] **Step 1: Write the failing tests**

```swift
import XCTest
@testable import NativeSlice

final class WSCodecTests: XCTestCase {
    func testEncodeRequestProducesEnvelope() throws {
        let text = WSCodec.encodeRequest(type: "task:list", correlationId: "abc", payload: [:])
        let obj = try JSONSerialization.jsonObject(with: XCTUnwrap(text).data(using: .utf8)!) as! [String: Any]
        XCTAssertEqual(obj["type"] as? String, "task:list")
        XCTAssertEqual(obj["correlationId"] as? String, "abc")
        XCTAssertNotNil(obj["payload"])
    }

    func testDecodeResponseCarriesCorrelationId() throws {
        let text = #"{"correlationId":"c1","type":"task:list","payload":{"tasks":[]}}"#
        guard case let .response(correlationId, type, payload) = try XCTUnwrap(WSCodec.decode(text)) else {
            return XCTFail("expected response")
        }
        XCTAssertEqual(correlationId, "c1")
        XCTAssertEqual(type, "task:list")
        let p = try JSONSerialization.jsonObject(with: payload) as! [String: Any]
        XCTAssertNotNil(p["tasks"])
    }

    func testDecodeEventHasNoCorrelationId() throws {
        let text = #"{"type":"task:updated","payload":{"task":{"id":"t1"}}}"#
        guard case let .event(type, _) = try XCTUnwrap(WSCodec.decode(text)) else {
            return XCTFail("expected event")
        }
        XCTAssertEqual(type, "task:updated")
    }

    func testDecodeGarbageReturnsNil() {
        XCTAssertNil(WSCodec.decode("not json"))
    }
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd experiments/native-slice && swift test --filter WSCodecTests`
Expected: FAIL — `WSCodec` / `WSInbound` undefined.

- [ ] **Step 3: Implement `WSCodec.swift`**

```swift
import Foundation

enum WSInbound: Equatable {
    case response(correlationId: String, type: String, payload: Data)
    case event(type: String, payload: Data)
}

enum WSCodec {
    static func encodeRequest(type: String, correlationId: String, payload: [String: Any]) -> String? {
        let body: [String: Any] = ["correlationId": correlationId, "type": type, "payload": payload]
        guard let data = try? JSONSerialization.data(withJSONObject: body) else { return nil }
        return String(data: data, encoding: .utf8)
    }

    static func decode(_ text: String) -> WSInbound? {
        guard let data = text.data(using: .utf8),
              let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let type = obj["type"] as? String else { return nil }
        let payloadObj = obj["payload"] ?? [:]
        let payload = (try? JSONSerialization.data(withJSONObject: payloadObj)) ?? Data("{}".utf8)
        if let correlationId = obj["correlationId"] as? String {
            return .response(correlationId: correlationId, type: type, payload: payload)
        }
        return .event(type: type, payload: payload)
    }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd experiments/native-slice && swift test --filter WSCodecTests`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add experiments/native-slice/Sources/NativeSlice/Transport/WSCodec.swift experiments/native-slice/Tests/NativeSliceTests/WSCodecTests.swift
git commit -m "spike(slice): WS envelope codec with tests"
```

---

### Task 3: WSClient — RPC correlation, timeout, reconnect

Wrap `URLSessionWebSocketTask` (the transport proven in `BackendWatch.swift`) into a generic client: `request()` resolves the matching response by correlationId or rejects after 30s; `on(event:)` registers broadcast handlers; the receive loop dispatches via `WSCodec`; drops trigger exponential-backoff reconnect. The pending-request map and timeout are the unit-testable core (verified by directly driving the inbound handler); the live-socket path is integration-verified in Task 5.

**Files:**
- Create: `experiments/native-slice/Sources/NativeSlice/Transport/WSClient.swift`
- Test: `experiments/native-slice/Tests/NativeSliceTests/WSClientTests.swift`

**Interfaces:**
- Consumes: `WSCodec`, `WSInbound`.
- Produces (all `@MainActor`):
  - `final class WSClient` with `init(url: URL)`
  - `func request(type: String, payload: [String: Any]) async throws -> Data` (returns the response payload JSON)
  - `func on(event type: String, _ handler: @escaping (Data) -> Void) -> () -> Void` (returns an unsubscribe closure)
  - `func send(type: String, payload: [String: Any])` (fire-and-forget)
  - `func connect()` / `func disconnect()`
  - `func handleInbound(_ inbound: WSInbound)` (internal seam the receive loop calls; tests call it directly)
  - `enum WSClientError: Error { case timeout, notConnected, badResponse }`

- [ ] **Step 1: Write the failing tests** (drive `handleInbound` directly — no real socket)

```swift
import XCTest
@testable import NativeSlice

@MainActor
final class WSClientTests: XCTestCase {
    func testResponseResolvesPendingRequest() async throws {
        let client = WSClient(url: URL(string: "ws://localhost:1")!)
        async let result: Data = client.awaitNextCorrelation { cid in
            client.handleInbound(.response(correlationId: cid, type: "task:list",
                                           payload: Data(#"{"tasks":[]}"#.utf8)))
        }
        let payload = try await result
        let obj = try JSONSerialization.jsonObject(with: payload) as! [String: Any]
        XCTAssertNotNil(obj["tasks"])
    }

    func testEventFansOutToHandlers() {
        let client = WSClient(url: URL(string: "ws://localhost:1")!)
        var received: Data?
        _ = client.on(event: "task:updated") { received = $0 }
        client.handleInbound(.event(type: "task:updated", payload: Data(#"{"task":{"id":"t1"}}"#.utf8)))
        XCTAssertNotNil(received)
    }

    func testUnsubscribeStopsDelivery() {
        let client = WSClient(url: URL(string: "ws://localhost:1")!)
        var count = 0
        let off = client.on(event: "task:created") { _ in count += 1 }
        client.handleInbound(.event(type: "task:created", payload: Data("{}".utf8)))
        off()
        client.handleInbound(.event(type: "task:created", payload: Data("{}".utf8)))
        XCTAssertEqual(count, 1)
    }
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd experiments/native-slice && swift test --filter WSClientTests`
Expected: FAIL — `WSClient` undefined.

- [ ] **Step 3: Implement `WSClient.swift`**

```swift
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

    func urlSession(_ session: URLSession, webSocketTask: URLSessionWebSocketTask,
                    didOpenWithProtocol protocol: String?) {
        reconnectAttempt = 0
    }

    // Test helper: run `trigger` with a fresh correlationId after registering the
    // continuation, so a test can feed the matching response synchronously.
    func awaitNextCorrelation(_ trigger: @escaping (String) -> Void) async throws -> Data {
        let correlationId = UUID().uuidString
        return try await withCheckedThrowingContinuation { cont in
            pending[correlationId] = cont
            trigger(correlationId)
        }
    }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd experiments/native-slice && swift test --filter WSClientTests`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add experiments/native-slice/Sources/NativeSlice/Transport/WSClient.swift experiments/native-slice/Tests/NativeSliceTests/WSClientTests.swift
git commit -m "spike(slice): generic WSClient (RPC correlation, timeout, reconnect) with tests"
```

---

### Task 4: Task model + TaskStore reducers (pure, TDD)

A minimal `Task` decoded from the `task:list` response and `task:updated`/`task:created` events, plus an `ObservableObject` store whose reducer logic (initial load, upsert) is pure-tested. Field names mirror the real backend payload (`id`, `projectId`, `title`, `status`, `createdAt`); Swift `Codable` ignores the many extra keys.

**Files:**
- Create: `experiments/native-slice/Sources/NativeSlice/Models/TaskModel.swift`
- Create: `experiments/native-slice/Sources/NativeSlice/Stores/TaskStore.swift`
- Test: `experiments/native-slice/Tests/NativeSliceTests/TaskStoreTests.swift`

**Interfaces:**
- Consumes: `WSClient`.
- Produces:
  - `struct TaskItem: Codable, Identifiable, Equatable { let id: String; let projectId: String; let title: String; let status: String; let createdAt: String }`
  - `enum TaskReducer { static func upsert(_ tasks: [TaskItem], _ task: TaskItem) -> [TaskItem]; static func sortedByCreatedDesc(_ tasks: [TaskItem]) -> [TaskItem] }`
  - `@MainActor final class TaskStore: ObservableObject { @Published var tasks: [TaskItem]; init(client: WSClient); func load() async; func bindEvents() }`

- [ ] **Step 1: Write the failing tests**

```swift
import XCTest
@testable import NativeSlice

final class TaskStoreTests: XCTestCase {
    private func task(_ id: String, _ created: String, _ title: String = "t") -> TaskItem {
        TaskItem(id: id, projectId: "p", title: title, status: "active", createdAt: created)
    }

    func testUpsertAddsNewTask() {
        let result = TaskReducer.upsert([task("a", "2026-01-01")], task("b", "2026-01-02"))
        XCTAssertEqual(result.map(\.id).sorted(), ["a", "b"])
    }

    func testUpsertReplacesExistingById() {
        let result = TaskReducer.upsert([task("a", "2026-01-01", "old")], task("a", "2026-01-01", "new"))
        XCTAssertEqual(result.count, 1)
        XCTAssertEqual(result.first?.title, "new")
    }

    func testSortNewestFirst() {
        let sorted = TaskReducer.sortedByCreatedDesc([task("a", "2026-01-01"), task("b", "2026-02-01")])
        XCTAssertEqual(sorted.map(\.id), ["b", "a"])
    }

    func testDecodeTaskListResponseIgnoresExtraKeys() throws {
        let json = #"{"tasks":[{"id":"t1","projectId":"p1","title":"Build","status":"active","createdAt":"2026-06-26T00:00:00Z","notes":"ignored","pinned":false}]}"#
        struct Resp: Codable { let tasks: [TaskItem] }
        let resp = try JSONDecoder().decode(Resp.self, from: Data(json.utf8))
        XCTAssertEqual(resp.tasks.first?.title, "Build")
    }
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd experiments/native-slice && swift test --filter TaskStoreTests`
Expected: FAIL — `TaskItem` / `TaskReducer` undefined.

- [ ] **Step 3: Implement `TaskModel.swift`**

```swift
import Foundation

struct TaskItem: Codable, Identifiable, Equatable {
    let id: String
    let projectId: String
    let title: String
    let status: String
    let createdAt: String
}

enum TaskReducer {
    static func upsert(_ tasks: [TaskItem], _ task: TaskItem) -> [TaskItem] {
        if let idx = tasks.firstIndex(where: { $0.id == task.id }) {
            var copy = tasks
            copy[idx] = task
            return copy
        }
        return tasks + [task]
    }

    static func sortedByCreatedDesc(_ tasks: [TaskItem]) -> [TaskItem] {
        tasks.sorted { $0.createdAt > $1.createdAt }
    }
}
```

- [ ] **Step 4: Implement `TaskStore.swift`**

```swift
import Foundation

@MainActor
final class TaskStore: ObservableObject {
    @Published private(set) var tasks: [TaskItem] = []

    private let client: WSClient
    private var unsubscribers: [() -> Void] = []

    init(client: WSClient) { self.client = client }

    private struct TaskListResponse: Codable { let tasks: [TaskItem] }
    private struct TaskEvent: Codable { let task: TaskItem }

    func load() async {
        do {
            let payload = try await client.request(type: "task:list", payload: [:])
            let resp = try JSONDecoder().decode(TaskListResponse.self, from: payload)
            tasks = TaskReducer.sortedByCreatedDesc(resp.tasks)
        } catch {
            NSLog("TaskStore.load failed: \(error)")
        }
    }

    func bindEvents() {
        let apply: (Data) -> Void = { [weak self] data in
            guard let self,
                  let event = try? JSONDecoder().decode(TaskEvent.self, from: data) else { return }
            self.tasks = TaskReducer.sortedByCreatedDesc(TaskReducer.upsert(self.tasks, event.task))
        }
        unsubscribers.append(client.on(event: "task:updated", apply))
        unsubscribers.append(client.on(event: "task:created", apply))
    }

    deinit { unsubscribers.forEach { $0() } }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd experiments/native-slice && swift test --filter TaskStoreTests`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add experiments/native-slice/Sources/NativeSlice/Models/TaskModel.swift experiments/native-slice/Sources/NativeSlice/Stores/TaskStore.swift experiments/native-slice/Tests/NativeSliceTests/TaskStoreTests.swift
git commit -m "spike(slice): TaskItem model + TaskStore with reducer tests"
```

---

### Task 5: App shell + live task sidebar (unit 1.3)

Wire the shell: an `HSplitView` with a sidebar bound to `TaskStore`, connected to the live backend over WS. This is the first integration verification — real task rows from the running backend. Selecting a task publishes a selection the workspace (Task 6) will consume.

**Files:**
- Modify: `experiments/native-slice/Sources/NativeSlice/App.swift`
- Create: `experiments/native-slice/Sources/NativeSlice/Environment.swift`
- Create: `experiments/native-slice/Sources/NativeSlice/UI/SidebarView.swift`
- Create: `experiments/native-slice/Sources/NativeSlice/UI/RootView.swift`

**Interfaces:**
- Consumes: `WSClient`, `TaskStore`, `TaskItem`.
- Produces:
  - `enum SliceEnv { static func backendURL() -> URL }`
  - `@MainActor final class AppModel: ObservableObject { let client: WSClient; let taskStore: TaskStore; @Published var selectedTaskId: String?; func start() }`
  - `struct RootView: View` (HSplitView shell), `struct SidebarView: View`.

- [ ] **Step 1: Implement `Environment.swift`**

```swift
import Foundation

enum SliceEnv {
    static func backendURL() -> URL {
        let raw = ProcessInfo.processInfo.environment["TASKFLOW_API_URL"] ?? "http://localhost:63074"
        var comps = URLComponents(string: raw)!
        comps.scheme = (comps.scheme == "https") ? "wss" : "ws"
        return comps.url!
    }
}
```

- [ ] **Step 2: Implement `SidebarView.swift`**

```swift
import SwiftUI

struct SidebarView: View {
    @ObservedObject var taskStore: TaskStore
    @Binding var selectedTaskId: String?

    var body: some View {
        List(selection: $selectedTaskId) {
            Section("Tasks (\(taskStore.tasks.count))") {
                ForEach(taskStore.tasks) { task in
                    HStack {
                        Circle()
                            .fill(task.status == "active" ? Color.green : Color.secondary)
                            .frame(width: 7, height: 7)
                        Text(task.title).lineLimit(1)
                    }
                    .tag(task.id)
                }
            }
        }
        .listStyle(.sidebar)
        .frame(minWidth: 240)
    }
}
```

- [ ] **Step 3: Implement `RootView.swift` + `AppModel`**

```swift
import SwiftUI

@MainActor
final class AppModel: ObservableObject {
    let client: WSClient
    let taskStore: TaskStore
    @Published var selectedTaskId: String?

    init() {
        let client = WSClient(url: SliceEnv.backendURL())
        self.client = client
        self.taskStore = TaskStore(client: client)
    }

    func start() {
        client.connect()
        taskStore.bindEvents()
        Task { await taskStore.load() }
    }
}

struct RootView: View {
    @StateObject private var model = AppModel()

    var body: some View {
        HSplitView {
            SidebarView(taskStore: model.taskStore, selectedTaskId: $model.selectedTaskId)
            WorkspaceView(selectedTaskId: model.selectedTaskId)   // defined in Task 6
                .frame(minWidth: 600)
        }
        .frame(minWidth: 1100, minHeight: 720)
        .onAppear { model.start() }
    }
}
```

- [ ] **Step 4: Replace `App.swift` body to host `RootView`**

```swift
import SwiftUI

struct SliceApp: App {
    var body: some Scene {
        WindowGroup("Taskflow Native Slice") {
            RootView()
        }
    }
}
```

> `WorkspaceView` does not exist yet — Task 6 creates it. To keep this task independently buildable, add a temporary stub now and replace it in Task 6.

- [ ] **Step 5: Add a temporary `WorkspaceView` stub**

Create `experiments/native-slice/Sources/NativeSlice/UI/WorkspaceView.swift`:

```swift
import SwiftUI

struct WorkspaceView: View {
    let selectedTaskId: String?
    var body: some View {
        Text(selectedTaskId.map { "Selected task: \($0)" } ?? "No task selected")
            .foregroundStyle(.secondary)
    }
}
```

- [ ] **Step 6: Build, launch against the live backend, observe**

Run: `cd experiments/native-slice && swift build && ./.build/debug/NativeSlice`
Expected: window shows a sidebar listing **real tasks from the running backend** (at least this task, "Build native app experiment"). Clicking a task updates the right pane to "Selected task: <id>". Leave it running; in another shell create a task via the app or `taskflow-cli` and confirm a new row appears live (proves `task:created` event binding).

- [ ] **Step 7: Capture evidence**

Save a screenshot to `experiments/native-slice/evidence/01-live-sidebar.png` (window with the populated sidebar).

- [ ] **Step 8: Commit**

```bash
git add experiments/native-slice/Sources/NativeSlice/Environment.swift experiments/native-slice/Sources/NativeSlice/UI/SidebarView.swift experiments/native-slice/Sources/NativeSlice/UI/RootView.swift experiments/native-slice/Sources/NativeSlice/UI/WorkspaceView.swift experiments/native-slice/Sources/NativeSlice/App.swift experiments/native-slice/evidence/01-live-sidebar.png
git commit -m "spike(slice): app shell + live task sidebar over WS"
```

---

### Task 6: Workspace tabbed split with draggable tabs (unit 1.4, structural half)

Replace the stub with the structural heart: a workspace that, for a selected task, shows a horizontal split whose left side is a tab bar with **reorderable (drag) tabs**. Two tabs: "Terminal" and "Editor" (panes filled in Tasks 7–8). This proves split + tabs + drag — the spine seam — before the panes go in.

**Files:**
- Modify: `experiments/native-slice/Sources/NativeSlice/UI/WorkspaceView.swift`
- Create: `experiments/native-slice/Sources/NativeSlice/UI/PaneTab.swift`

**Interfaces:**
- Consumes: `selectedTaskId`.
- Produces:
  - `enum PaneKind: String, CaseIterable, Identifiable { case terminal, editor; var id: String { rawValue }; var title: String }`
  - `struct WorkspaceView: View` rendering an `HSplitView` of a tab strip + active pane; tabs reorder via `.onDrag`/`.onDrop`.

- [ ] **Step 1: Implement `PaneTab.swift`**

```swift
import SwiftUI
import UniformTypeIdentifiers

enum PaneKind: String, CaseIterable, Identifiable {
    case terminal, editor
    var id: String { rawValue }
    var title: String { self == .terminal ? "Terminal" : "Editor" }
}

struct TabStrip: View {
    @Binding var order: [PaneKind]
    @Binding var active: PaneKind

    var body: some View {
        HStack(spacing: 4) {
            ForEach(order) { kind in
                Text(kind.title)
                    .padding(.horizontal, 12).padding(.vertical, 6)
                    .background(active == kind ? Color.accentColor.opacity(0.2) : Color.clear)
                    .clipShape(RoundedRectangle(cornerRadius: 6))
                    .onTapGesture { active = kind }
                    .onDrag { NSItemProvider(object: kind.rawValue as NSString) }
                    .onDrop(of: [.text], delegate: TabDropDelegate(item: kind, order: $order))
            }
            Spacer()
        }
        .padding(6)
    }
}

private struct TabDropDelegate: DropDelegate {
    let item: PaneKind
    @Binding var order: [PaneKind]

    func dropEntered(info: DropInfo) {
        guard let from = info.itemProviders(for: [.text]).first else { return }
        from.loadObject(ofClass: NSString.self) { obj, _ in
            guard let raw = obj as? String, let dragged = PaneKind(rawValue: raw),
                  dragged != item,
                  let f = order.firstIndex(of: dragged), let t = order.firstIndex(of: item) else { return }
            DispatchQueue.main.async {
                withAnimation { order.move(fromOffsets: IndexSet(integer: f),
                                           toOffset: t > f ? t + 1 : t) }
            }
        }
    }
    func performDrop(info: DropInfo) -> Bool { true }
}
```

- [ ] **Step 2: Implement `WorkspaceView.swift`**

```swift
import SwiftUI

struct WorkspaceView: View {
    let selectedTaskId: String?

    @State private var order: [PaneKind] = PaneKind.allCases
    @State private var active: PaneKind = .terminal

    var body: some View {
        if let taskId = selectedTaskId {
            VStack(spacing: 0) {
                TabStrip(order: $order, active: $active)
                Divider()
                HSplitView {
                    paneContent(for: active, taskId: taskId)
                        .frame(minWidth: 320)
                    InfoPane(taskId: taskId)
                        .frame(minWidth: 200)
                }
            }
        } else {
            Text("Select a task").foregroundStyle(.secondary)
        }
    }

    @ViewBuilder
    private func paneContent(for kind: PaneKind, taskId: String) -> some View {
        switch kind {
        case .terminal: Text("Terminal pane — Task 7").frame(maxWidth: .infinity, maxHeight: .infinity)
        case .editor:   Text("Editor pane — Task 8").frame(maxWidth: .infinity, maxHeight: .infinity)
        }
    }
}

private struct InfoPane: View {
    let taskId: String
    var body: some View {
        VStack(alignment: .leading) { Text("Task").font(.headline); Text(taskId).font(.caption) }
            .padding().frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }
}
```

- [ ] **Step 3: Build, launch, observe split + tab drag**

Run: `cd experiments/native-slice && swift build && ./.build/debug/NativeSlice`
Expected: selecting a task shows a tab strip ("Terminal", "Editor") above a resizable horizontal split. Clicking switches the active pane placeholder; **dragging one tab past the other reorders them**; dragging the split divider resizes the panes.

- [ ] **Step 4: Capture evidence**

Save `experiments/native-slice/evidence/02-workspace-tabs-split.png`.

- [ ] **Step 5: Commit**

```bash
git add experiments/native-slice/Sources/NativeSlice/UI/WorkspaceView.swift experiments/native-slice/Sources/NativeSlice/UI/PaneTab.swift experiments/native-slice/evidence/02-workspace-tabs-split.png
git commit -m "spike(slice): workspace tabbed split with draggable tabs"
```

---

### Task 7: Terminal pane via libghostty `.exec` (unit 1.4, terminal half)

Drop a real GPU libghostty terminal into the Terminal tab, wrapped in `NSViewRepresentable`. Lift the proven `.exec` setup from `native-spike/Sources/NativeSpike/AppDelegate.swift` (`startExecMode`). This confirms a Metal surface lives inside a SwiftUI workspace tab — the two-render-worlds seam.

**Files:**
- Create: `experiments/native-slice/Sources/NativeSlice/UI/TerminalPane.swift`
- Modify: `experiments/native-slice/Sources/NativeSlice/UI/WorkspaceView.swift:paneContent`

**Interfaces:**
- Consumes: `GhosttyTerminal` (`TerminalView`, `TerminalViewState`, `TerminalConfiguration`, `TerminalSurfaceOptions`, `.exec`).
- Produces: `struct TerminalPane: NSViewRepresentable` rendering a `.exec` libghostty surface in the given working directory.

- [ ] **Step 1: Implement `TerminalPane.swift`** (adapted from the proven spike)

```swift
import SwiftUI
import GhosttyTerminal

struct TerminalPane: NSViewRepresentable {
    let workingDirectory: String

    func makeCoordinator() -> Coordinator { Coordinator() }

    final class Coordinator {
        var state: TerminalViewState?
    }

    func makeNSView(context: Context) -> NSView {
        let bootScript = """
        echo '── native-slice: libghostty .exec surface live ──'; \
        command -v claude >/dev/null && exec claude || exec /bin/zsh -l
        """
        let command = "/bin/zsh -lc \"\(bootScript.replacingOccurrences(of: "\"", with: "\\\""))\""
        let config = TerminalConfiguration(startingFrom: .default) { builder in
            builder.withCustom("command", command)
            builder.withFontSize(14)
        }
        let state = TerminalViewState(configSource: .generated(config.rendered))
        context.coordinator.state = state

        let terminal = TerminalView(frame: .zero)
        terminal.delegate = state
        terminal.controller = state.controller
        terminal.configuration = TerminalSurfaceOptions(backend: .exec, workingDirectory: workingDirectory)
        return terminal
    }

    func updateNSView(_ nsView: NSView, context: Context) {}
}
```

- [ ] **Step 2: Wire it into `WorkspaceView.paneContent`**

Replace the `.terminal` case:

```swift
        case .terminal:
            TerminalPane(workingDirectory: FileManager.default.currentDirectoryPath)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
```

- [ ] **Step 3: Build, launch, observe a live terminal in the tab**

Run: `cd experiments/native-slice && swift build && ./.build/debug/NativeSlice`
Expected: the Terminal tab GPU-renders a live shell/`claude`; typing works; switching to Editor and back keeps it alive; the split divider resizes the terminal and the grid reflows.

- [ ] **Step 4: Capture evidence**

Save `experiments/native-slice/evidence/03-terminal-pane-live.png`.

- [ ] **Step 5: Commit**

```bash
git add experiments/native-slice/Sources/NativeSlice/UI/TerminalPane.swift experiments/native-slice/Sources/NativeSlice/UI/WorkspaceView.swift experiments/native-slice/evidence/03-terminal-pane-live.png
git commit -m "spike(slice): live libghostty .exec terminal pane in workspace tab"
```

---

### Task 8: Native editor pane via CodeEditSourceEditor (unit 1.4, editor half)

Fill the Editor tab with the pinned native editor, opening a real file with syntax highlighting. This is the integration test of the pre-production editor dependency — the unknown unit 1.2 exists to retire.

**Files:**
- Create: `experiments/native-slice/Sources/NativeSlice/UI/EditorPane.swift`
- Modify: `experiments/native-slice/Sources/NativeSlice/UI/WorkspaceView.swift:paneContent`

**Interfaces:**
- Consumes: `CodeEditSourceEditor`.
- Produces: `struct EditorPane: View` showing an editable, syntax-highlighted buffer loaded from a file path.

- [ ] **Step 1: Implement `EditorPane.swift`**

```swift
import SwiftUI
import CodeEditSourceEditor
import CodeEditLanguages

struct EditorPane: View {
    let filePath: String

    @State private var text: String = ""
    @State private var cursors: Set<CursorPosition> = [CursorPosition(line: 1, column: 1)]

    var body: some View {
        CodeEditSourceEditor(
            $text,
            language: .swift,
            theme: EditorTheme.standard,
            font: .monospacedSystemFont(ofSize: 13, weight: .regular),
            tabWidth: 4,
            lineHeight: 1.2,
            wrapLines: true,
            cursorPositions: $cursors
        )
        .onAppear {
            text = (try? String(contentsOfFile: filePath, encoding: .utf8))
                ?? "// could not read \(filePath)"
        }
    }
}
```

> `EditorTheme.standard` is illustrative — if the pinned version names the default theme differently (e.g. a constructed `EditorTheme(...)`), use the initializer shown in that version's `README`/`Examples`. Record the exact symbol used in the Task 9 writeup. The contract for this task is: an editable, highlighted buffer renders a real file.

- [ ] **Step 2: Wire it into `WorkspaceView.paneContent`**

Replace the `.editor` case (open this plan file as a convenient real target):

```swift
        case .editor:
            EditorPane(filePath: FileManager.default.currentDirectoryPath
                + "/Sources/NativeSlice/UI/WorkspaceView.swift")
                .frame(maxWidth: .infinity, maxHeight: .infinity)
```

- [ ] **Step 3: Build, launch, observe the editor**

Run: `cd experiments/native-slice && swift build && ./.build/debug/NativeSlice`
Expected: the Editor tab shows the file's contents with syntax highlighting; typing edits the buffer; find/replace (Cmd+F) works; switching tabs preserves state.

- [ ] **Step 4: Capture evidence**

Save `experiments/native-slice/evidence/04-editor-pane.png`.

- [ ] **Step 5: Commit**

```bash
git add experiments/native-slice/Sources/NativeSlice/UI/EditorPane.swift experiments/native-slice/Sources/NativeSlice/UI/WorkspaceView.swift experiments/native-slice/evidence/04-editor-pane.png
git commit -m "spike(slice): native CodeEditSourceEditor pane in workspace tab"
```

---

### Task 9: GO/NO-GO writeup (unit 1.6)

Synthesize the slice into the commit-or-not decision spec. No code — this is the deliverable the whole phase exists to produce.

**Files:**
- Create: `docs/superpowers/specs/2026-06-26-ui-vertical-slice-spike-results.md`

**Interfaces:**
- Consumes: Tasks 1–8 outcomes + `evidence/*.png`.
- Produces: a GO / NO-GO record that gates Phases 2–6 of the master plan.

- [ ] **Step 1: Write the results spec**

Cover, with evidence references:
- **What was proven:** shell + live WS sidebar (Task 5), tabbed split + drag (Task 6), libghostty in a SwiftUI tab (Task 7), native editor (Task 8), the Swift WS store layer end-to-end (Tasks 3–5).
- **Per-seam verdict** — for each of: workspace split/tabs/drag, store→view-model + WS transport, libghostty↔SwiftUI two-render-worlds (focus/key-routing/theming), native editor maturity. Mark each Smooth / Friction / Blocker, with specifics.
- **Dependency-risk retirement (1.1/1.2):** the exact pinned versions used (`libghostty-spm`, `CodeEditSourceEditor`), and any surprises during integration. Record the actual `CodeEditSourceEditor` tag and theme/init symbols used.
- **Friction log:** anything that fought back (API mismatches vs this plan's illustrative code, focus/key-routing quirks between Metal and SwiftUI, editor theming).
- **Decision: GO or NO-GO**, with the reasoning. If GO, confirm Phases 2–6 of `2026-06-26-native-rewrite-master-plan.md` are greenlit. If NO-GO, record what killed it.

- [ ] **Step 2: Commit**

```bash
git add docs/superpowers/specs/2026-06-26-ui-vertical-slice-spike-results.md
git commit -m "docs: UI vertical-slice spike results + GO/NO-GO"
```

---

## Self-Review

**Spec coverage** (against the master plan's Phase 1 units):
- Unit 1.1 (vendor/pin libghostty fork) → Task 1 (exact pin) + Task 9 (record). ✅
- Unit 1.2 (pick + vendor native editor dep) → Task 1 (exact pin) + Task 8 (integrate) + Task 9 (record). ✅
- Unit 1.3 (app shell slice, real WS data) → Task 5. ✅
- Unit 1.4 (workspace tabbed split: terminal + editor) → Tasks 6 (split/tabs/drag) + 7 (terminal) + 8 (editor). ✅
- Unit 1.5 (Swift WS store layer) → Tasks 2 (codec) + 3 (client) + 4 (store). ✅
- Unit 1.6 (GO/NO-GO writeup) → Task 9. ✅

**Placeholder scan:** Illustrative-API call-outs in Tasks 1 and 8 (editor version tag, `EditorTheme` symbol) are flagged explicitly with a concrete fallback action and a "record the actual symbol in Task 9" instruction, because the pinned dependency's exact public API can drift between tags — this is honest dependency integration, not a deferred decision. No bare TBD/TODO remain.

**Type consistency:** `WSInbound`, `WSCodec.encodeRequest/decode`, `WSClient.request/on/handleInbound`, `TaskItem` fields (`id/projectId/title/status/createdAt`), `TaskReducer.upsert/sortedByCreatedDesc`, `TaskStore.load/bindEvents`, `PaneKind`, `WorkspaceView(selectedTaskId:)`, `TerminalPane(workingDirectory:)`, `EditorPane(filePath:)` are referenced consistently across tasks.

## Notes for the executor

- **TDD scope:** Tasks 2–4 are pure logic and follow strict red→green TDD. Tasks 5–8 are GPU/AppKit/WS integration where the honest verification is build + launch + observe + screenshot evidence (mirroring the Phase 0 `native-spike/evidence/` pattern). Do not fabricate unit tests around Metal/AppKit surfaces.
- **Backend must be running.** Tasks 5–7 verify against the live Taskflow backend; launch the slice from inside a Taskflow session (or export `TASKFLOW_API_URL`) so the WS URL and env resolve.
- **Leave `native-spike/` untouched** — it is Phase 0 evidence. This plan builds a sibling `native-slice/`.
- **This is the gate.** Task 9's GO/NO-GO governs whether master-plan Phases 2–6 proceed. Nothing past it is greenlit.
