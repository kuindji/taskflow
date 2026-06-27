import Foundation
import Observation

/// 1:1 port of `packages/ui/src/stores/flow-store.ts`.
///
/// Behavioral notes:
/// - `load()` fires `fetchFlows` + `fetchActions` concurrently (TS calls both on mount).
/// - `loadingDefinitions`/`definitionLoadCount` mirror the concurrent-load counter in the TS store:
///   each fetch increments the counter on entry and decrements it in a `defer`, setting
///   `loadingDefinitions` from the counter rather than a bare bool.
/// - `startFlow` returns the new `FlowRun` and caches it by `ownerId`.
/// - `fetchFlowRuns` uses a private `Decodable` wrapper because the generated
///   `FlowRunsListResponse` uses `[AnyCodable]` (codegen cannot flatten the discriminated union).
/// - `bind()` subscribes to `flow:run-updated` and drives `receiveRunUpdate(_:)`.
/// - `onRunFocus` models the `focusRunningActionTab` side-effect from the TS module level;
///   Task 8 wires the guard logic into the closure implementation.
@MainActor
@Observable
final class FlowViewModel {
    private(set) var flows: [FlowDefinition] = []
    private(set) var actions: [ActionDefinition] = []
    private(set) var loadingDefinitions: Bool = false
    private(set) var definitionLoadCount: Int = 0
    private(set) var activeRuns: [String: FlowRun] = [:]

    /// Injected: mirrors `focusRunningActionTab(run)` called after every `flow:run-updated` event.
    /// Task 8 wires the guard (`run.status == .running`, workspace-active check, tab lookup).
    var onRunFocus: ((FlowRun) -> Void)?

    @ObservationIgnored private let client: WSClient

    init(client: WSClient) {
        self.client = client
    }

    // MARK: - Load

    /// Fires both initial fetches concurrently. Called once by `AppEnvironment.boot()`.
    func load() async {
        async let _ = fetchFlows()
        async let _ = fetchActions()
    }

    // MARK: - Bind (WS event subscriptions)

    /// Registers the module-level `flow:run-updated` subscription from `flow-store.ts`.
    /// Call once at composition (from `AppEnvironment.bind()`).
    func bind() {
        client.on(.flowRunUpdated) { [weak self] (run: FlowRun) in
            Task { @MainActor [weak self] in
                guard let self else { return }
                receiveRunUpdate(run)
            }
        }
    }

    // MARK: - Definition actions

    /// Fetches the flow definitions list. Mirrors `fetchFlows` in `flow-store.ts`.
    func fetchFlows() async throws {
        definitionLoadCount += 1
        loadingDefinitions = true
        defer {
            definitionLoadCount = max(0, definitionLoadCount - 1)
            loadingDefinitions = definitionLoadCount > 0
        }
        let resp: FlowDefinitionsListResponse = try await client.request(.flowDefinitionsList, payload: [:])
        flows = resp.flows
    }

    /// Fetches the action definitions list. Mirrors `fetchActions` in `flow-store.ts`.
    func fetchActions() async throws {
        definitionLoadCount += 1
        loadingDefinitions = true
        defer {
            definitionLoadCount = max(0, definitionLoadCount - 1)
            loadingDefinitions = definitionLoadCount > 0
        }
        let resp: FlowActionsListResponse = try await client.request(.flowActionsList, payload: [:])
        actions = resp.actions
    }

    /// Saves a flow definition and upserts it into the local list.
    func saveFlow(_ flow: FlowDefinition) async throws {
        guard let data = try? JSONEncoder().encode(flow),
              let payload = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
        else { return }
        _ = try await client.requestRaw(.flowDefinitionSave, payload: payload)
        if let index = flows.firstIndex(where: { $0.id == flow.id }) {
            flows[index] = flow
        } else {
            flows.append(flow)
        }
    }

    /// Saves an action definition and upserts it into the local list.
    func saveAction(_ action: ActionDefinition) async throws {
        guard let data = try? JSONEncoder().encode(action),
              let payload = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
        else { return }
        _ = try await client.requestRaw(.flowActionSave, payload: payload)
        if let index = actions.firstIndex(where: { $0.id == action.id }) {
            actions[index] = action
        } else {
            actions.append(action)
        }
    }

    /// Deletes a flow definition by id and removes it from the local list.
    func deleteFlow(id: String) async throws {
        _ = try await client.requestRaw(.flowDefinitionDelete, payload: ["id": id])
        flows = flows.filter { $0.id != id }
    }

    /// Deletes an action definition by id and removes it from the local list.
    func deleteAction(id: String) async throws {
        _ = try await client.requestRaw(.flowActionDelete, payload: ["id": id])
        actions = actions.filter { $0.id != id }
    }

    // MARK: - Run control actions

    /// Starts a flow run and caches the returned run by owner id.
    @discardableResult
    func startFlow(_ params: FlowStartPayload) async throws -> FlowRun {
        guard let data = try? JSONEncoder().encode(params),
              let payload = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
        else { throw WSClient.WSClientError.badResponse }
        let run: FlowRun = try await client.request(.flowStart, payload: payload)
        if let ownerId = run.ownerId() {
            activeRuns[ownerId] = run
        } else {
            NSLog("FlowViewModel.startFlow: dropping run with no owner (flowId=\(run.flowId))")
        }
        return run
    }

    /// Stops a flow run.
    func stopFlow(ownerId: String, flowId: String) async throws {
        _ = try await client.requestRaw(.flowStop, payload: ["ownerId": ownerId, "flowId": flowId])
    }

    /// Pauses a flow run.
    func pauseFlow(ownerId: String, flowId: String) async throws {
        _ = try await client.requestRaw(.flowPause, payload: ["ownerId": ownerId, "flowId": flowId])
    }

    /// Resumes a paused flow run.
    func resumeFlow(ownerId: String, flowId: String) async throws {
        _ = try await client.requestRaw(.flowResume, payload: ["ownerId": ownerId, "flowId": flowId])
    }

    /// Skips the current action in a flow run.
    func skipAction(ownerId: String, flowId: String) async throws {
        _ = try await client.requestRaw(.flowSkipAction, payload: ["ownerId": ownerId, "flowId": flowId])
    }

    /// Jumps to a specific action index in a flow run.
    /// `actionIndex` is `Double` to match the generated `FlowJumpToActionPayload.actionIndex`
    /// and `FlowRun.currentActionIndex` (callers can pass `run.currentActionIndex` directly).
    func jumpToAction(ownerId: String, flowId: String, actionIndex: Double) async throws {
        _ = try await client.requestRaw(
            .flowJumpToAction,
            payload: ["ownerId": ownerId, "flowId": flowId, "actionIndex": actionIndex]
        )
    }

    /// Fetches run history for an owner and caches the active (running/paused) run if any.
    func fetchFlowRuns(ownerId: String) async throws {
        // Use a private wrapper because generated FlowRunsListResponse.runs is [AnyCodable].
        struct Response: Decodable { let runs: [FlowRun] }
        let resp: Response = try await client.request(.flowRunsList, payload: ["ownerId": ownerId])
        if let active = resp.runs.first(where: { $0.status == .running || $0.status == .paused }) {
            activeRuns[ownerId] = active
        } else {
            activeRuns.removeValue(forKey: ownerId)
        }
    }

    // MARK: - WS event handler (also used in tests)

    /// Applies a run update and fires `onRunFocus` if set.
    /// Called by `bind()`'s `flow:run-updated` handler; also callable directly in tests.
    ///
    /// A run decoded from WS input with no owner (taskId/projectId/master all unset) is skipped
    /// entirely — neither `activeRuns` nor `onRunFocus` is touched — mirroring the TS behavior
    /// where `getFlowRunOwnerId`'s throw leaves that run untracked while the app survives.
    func receiveRunUpdate(_ run: FlowRun) {
        guard run.ownerId() != nil else {
            NSLog("FlowViewModel.receiveRunUpdate: skipping run with no owner (flowId=\(run.flowId))")
            return
        }
        activeRuns = Self.applyRunUpdate(activeRuns, run)
        onRunFocus?(run)
    }

    // MARK: - Pure Reducer (static, TDD'd)

    /// Mirrors `applyRunUpdate` in `flow-store.ts`:
    /// inserts or replaces a run keyed by `ownerId`, but only if the run is `running`/`paused`
    /// OR if we were already tracking the owner — completed/failed runs for new owners are ignored.
    ///
    /// A run with no owner (nil `ownerId()`) is a no-op: the input is returned unchanged so a
    /// malformed run can never crash or mis-key state (avoids bucketing under a bogus `""` key).
    static func applyRunUpdate(_ runs: [String: FlowRun], _ run: FlowRun) -> [String: FlowRun] {
        guard let ownerId = run.ownerId() else { return runs }
        if run.status == .running || run.status == .paused || runs[ownerId] != nil {
            var copy = runs
            copy[ownerId] = run
            return copy
        }
        return runs
    }
}
