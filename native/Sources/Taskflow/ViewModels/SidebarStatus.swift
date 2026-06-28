import Foundation

/// Pure session-status aggregation for the sidebar. Priority: attention > working > initializing.
/// Ports the rollup in components/sidebar/ProjectGroup.tsx (lines ~139–174).
enum SidebarStatus {
    nonisolated static func aggregate(_ statuses: [SessionStatus?]) -> SessionStatus? {
        var hasWorking = false
        var hasInitializing = false
        for s in statuses {
            switch s {
            case .attention: return .attention
            case .working: hasWorking = true
            case .initializing: hasInitializing = true
            case nil: continue
            }
        }
        if hasWorking { return .working }
        if hasInitializing { return .initializing }
        return nil
    }

    /// Project-level status from its own session ids, resolving each via `status`.
    nonisolated static func project(sessionIds: [String], status: (String) -> SessionStatus?) -> SessionStatus? {
        aggregate(sessionIds.map(status))
    }

    /// Combined badge for a project header: its own sessions + each task's rolled-up status.
    nonisolated static func rollup(projectStatus: SessionStatus?, taskStatuses: [SessionStatus?]) -> SessionStatus? {
        aggregate([projectStatus] + taskStatuses)
    }
}
