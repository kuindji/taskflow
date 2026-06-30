import Foundation
import Observation

/// Port of `packages/ui/src/stores/schedule-store.ts`.
///
/// CRUD over WebSocket + live `schedule:updated` subscription.
/// Mirrors `TaskViewModel` structure: `init(client:)`, `bind()`, `load(projectId:)`,
/// `create`/`update`/`delete`/`trigger`, and `nonisolated static` reducers.
///
/// Note: `load(projectId:)` is project-scoped and called lazily — it is NOT added to
/// `AppEnvironment.boot()`'s parallel-load group.
@MainActor
@Observable
final class ScheduleViewModel {
    private(set) var schedules: [Schedule] = []
    private(set) var loading = false
    @ObservationIgnored private let client: WSClient

    init(client: WSClient) {
        self.client = client
    }

    // MARK: - Bind (WS event subscriptions)

    /// Registers the `schedule:updated` event subscription. Call once from `AppEnvironment.compose(client:)`.
    func bind() {
        client.on(.scheduleUpdated) { [weak self] (s: Schedule) in
            Task { @MainActor [weak self] in
                guard let self else { return }
                schedules = Self.upsert(schedules, s)
            }
        }
    }

    // MARK: - Load

    /// Fetches the schedule list for the given project (or all schedules when `nil`).
    func load(projectId: String?) async {
        loading = true
        defer { loading = false }
        do {
            let payload: [String: Any] = projectId.map { ["projectId": $0] } ?? [:]
            let res: ScheduleListResponse = try await client.request(.scheduleList, payload: payload)
            schedules = res.schedules
        } catch {}
    }

    // MARK: - Create / Update / Delete / Trigger

    @discardableResult
    func create(_ payload: ScheduleCreatePayload) async throws -> Schedule {
        let dict = try Self.encodePayload(payload)
        let created: Schedule = try await client.request(.scheduleCreate, payload: dict)
        schedules = Self.upsert(schedules, created)
        return created
    }

    @discardableResult
    func update(_ payload: ScheduleUpdatePayload) async throws -> Schedule {
        let dict = try Self.encodePayload(payload)
        let updated: Schedule = try await client.request(.scheduleUpdate, payload: dict)
        schedules = Self.upsert(schedules, updated)
        return updated
    }

    func delete(id: String) async throws {
        _ = try await client.requestRaw(.scheduleDelete, payload: ["id": id])
        schedules = Self.remove(schedules, id: id)
    }

    func trigger(id: String) async throws {
        _ = try await client.requestRaw(.scheduleTrigger, payload: ["id": id])
    }

    // MARK: - Pure Reducers (nonisolated static, TDD'd)

    /// Replaces `s` in-place by id; appends if not found.
    nonisolated static func upsert(_ list: [Schedule], _ s: Schedule) -> [Schedule] {
        if let i = list.firstIndex(where: { $0.id == s.id }) {
            var copy = list
            copy[i] = s
            return copy
        }
        return list + [s]
    }

    /// Returns `list` with the schedule matching `id` removed.
    nonisolated static func remove(_ list: [Schedule], id: String) -> [Schedule] {
        list.filter { $0.id != id }
    }

    // MARK: - Private helpers

    /// Encodes a `Codable` payload struct to `[String: Any]` via `JSONEncoder` + `JSONSerialization`.
    /// Swift's `JSONEncoder` omits nil optionals by default, so optional fields are absent (not null)
    /// in the resulting dictionary. If the backend requires explicit `null` for nullable-to-clear
    /// semantics on `ScheduleUpdatePayload.actionId` / `agentType`, the form (Task 11) will need to
    /// handle that field specially — see task-5-report.md for the flag.
    nonisolated private static func encodePayload<T: Encodable>(_ payload: T) throws -> [String: Any] {
        let data = try JSONEncoder().encode(payload)
        return (try JSONSerialization.jsonObject(with: data) as? [String: Any]) ?? [:]
    }
}
