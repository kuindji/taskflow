import Foundation
import Observation

/// UI-local diff-stat pair mirroring `DiffStats` from `packages/ui/src/stores/diff-store.ts`.
/// UI-LOCAL (not in `@taskflow/shared`), hand-authored like `PendingMove`.
struct DiffStats: Equatable, Sendable {
    let additions: Int
    let deletions: Int
}

/// All per-target diff maps, replaced wholesale on each event so `@Observable` notifies readers.
/// Mirrors the seven `*ByProject` records in `diff-store.ts`. Keys are target ids (task OR project).
struct DiffState: Equatable, Sendable {
    var statsByProject: [String: DiffStats] = [:]
    var diffDisabledByProject: [String: Bool] = [:]
    var commitDisabledByProject: [String: Bool] = [:]
    var hasChangesByProject: [String: Bool] = [:]
    var branchByProject: [String: String] = [:]
    var aheadByProject: [String: Int] = [:]
    var behindByProject: [String: Int] = [:]
}

/// 1:1 port of `packages/ui/src/stores/diff-store.ts`.
/// Event-driven only: binds the `git:change-stats` broadcast (emitted by the backend
/// change-tracker). No RPC, no boot load. `onStatsByProjectChanged` mirrors the
/// `useDiffStore.subscribe` consumed by `file-store.ts:213` to refresh git status.
@MainActor
@Observable
final class DiffViewModel {
    private(set) var state = DiffState()

    /// Fired after an event changes `statsByProject` (wired in AppEnvironment to refresh
    /// the file explorer's git status). Mirrors the file-store.ts diff-store subscription.
    @ObservationIgnored var onStatsByProjectChanged: (() -> Void)?

    @ObservationIgnored private let client: WSClient
    init(client: WSClient) { self.client = client }

    // MARK: - Bind

    func bind() {
        client.on(.gitChangeStats) { [weak self] (event: ChangeStatsEvent) in
            Task { @MainActor [weak self] in
                guard let self else { return }
                let prev = state.statsByProject
                state = Self.apply(state, event)
                if state.statsByProject != prev { onStatsByProjectChanged?() }
            }
        }
    }

    // MARK: - Pure reducer (TDD'd)

    /// Applies one `git:change-stats` event. `stats == nil` removes the target from every map
    /// (target untracked). Otherwise: `statsByProject` is nil when additions+deletions are both
    /// zero (matching TS), other maps always set; a nil branch removes the branch key.
    nonisolated static func apply(_ state: DiffState, _ event: ChangeStatsEvent) -> DiffState {
        var s = state
        let id = event.targetId
        guard let stats = event.stats else {
            s.statsByProject[id] = nil
            s.diffDisabledByProject[id] = nil
            s.commitDisabledByProject[id] = nil
            s.hasChangesByProject[id] = nil
            s.branchByProject[id] = nil
            s.aheadByProject[id] = nil
            s.behindByProject[id] = nil
            return s
        }
        let add = Int(stats.additions)
        let del = Int(stats.deletions)
        s.statsByProject[id] = (add == 0 && del == 0) ? nil : DiffStats(additions: add, deletions: del)
        s.diffDisabledByProject[id] = stats.diffDisabled
        s.commitDisabledByProject[id] = stats.commitDisabled
        s.hasChangesByProject[id] = stats.hasChanges
        s.branchByProject[id] = stats.branch        // nil branch → removes the key
        s.aheadByProject[id] = Int(stats.ahead)
        s.behindByProject[id] = Int(stats.behind)
        return s
    }
}
