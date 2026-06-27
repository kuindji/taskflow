import Foundation

/// Port of `packages/ui/src/stores/session-activity.ts` + the terminal:output
/// status decision in `session-subscriptions.ts`. Timers settle a "working" session
/// to "attention" after inactivity; user keystrokes suppress activity-driven changes.
@MainActor
final class SessionActivity {
    /// Inactivity window before a working session settles to "attention".
    /// Matches `ACTIVITY_TIMEOUT` (3000) in `packages/ui/src/stores/session-activity.ts` line 13.
    static let timeoutMs: Int = 3000

    private var timers: [String: Task<Void, Never>] = [:]
    private var interacting: Set<String> = []

    /// Pure decision for a terminal:output event. Returns the status to write,
    /// or nil if no write is needed. Mirrors session-subscriptions.ts lines ~96–124.
    static func nextStatus(current: SessionStatus?, isInteracting: Bool, usesActivity: Bool) -> SessionStatus? {
        if current == .initializing { return .working }     // agent first output
        if isInteracting { return nil }
        if !usesActivity { return nil }
        if current != .working { return .working }
        return nil
    }

    func isInteracting(_ id: String) -> Bool { interacting.contains(id) }
    func markInteraction(_ id: String) { interacting.insert(id) }
    func clearInteraction(_ id: String) { interacting.remove(id) }

    func scheduleTimeout(_ id: String, settle: @escaping @MainActor () -> Void) {
        timers[id]?.cancel()
        timers[id] = Task { @MainActor in
            try? await Task.sleep(for: .milliseconds(Self.timeoutMs))
            if Task.isCancelled { return }
            settle()
        }
    }

    func clearTimer(_ id: String) { timers[id]?.cancel(); timers.removeValue(forKey: id) }
}
