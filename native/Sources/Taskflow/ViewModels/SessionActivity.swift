import Foundation

/// Port of `packages/ui/src/stores/session-activity.ts` + the terminal:output
/// status decision in `session-subscriptions.ts`. Timers settle a "working" session
/// to "attention" after inactivity; user keystrokes suppress activity-driven changes.
@MainActor
final class SessionActivity {
    /// Inactivity window before a working session settles to "attention".
    /// Matches `ACTIVITY_TIMEOUT` (3000) in `packages/ui/src/stores/session-activity.ts` line 13.
    static let timeoutMs: Int = 3000

    /// Suppression window after a user keystroke/resize during which terminal output
    /// must NOT flip the session to "working". Matches `INTERACTION_SUPPRESSION_MS` (500)
    /// in `packages/ui/src/stores/session-activity.ts` line 15.
    static let interactionSuppressionMs: Int = 500

    private var timers: [String: Task<Void, Never>] = [:]
    /// Timestamp of the last user interaction per session (ports `lastInteractionAt`).
    private var lastInteractionAt: [String: Date] = [:]

    /// Pure decision for a terminal:output event. Returns the status to write,
    /// or nil if no write is needed. Mirrors session-subscriptions.ts lines ~96–124.
    static func nextStatus(current: SessionStatus?, isInteracting: Bool, usesActivity: Bool) -> SessionStatus? {
        if current == .initializing { return .working }     // agent first output
        if isInteracting { return nil }
        if !usesActivity { return nil }
        if current != .working { return .working }
        return nil
    }

    /// Ports `isUserInteracting`: true only when fewer than `interactionSuppressionMs`
    /// have elapsed since the last interaction. `now` is injectable for testing.
    func isInteracting(_ id: String, now: Date = Date()) -> Bool {
        guard let lastAt = lastInteractionAt[id] else { return false }
        return now.timeIntervalSince(lastAt) < Double(Self.interactionSuppressionMs) / 1000
    }

    /// Ports `markInteraction`: records the interaction time. `at` is injectable for testing.
    func markInteraction(_ id: String, at: Date = Date()) { lastInteractionAt[id] = at }

    /// Ports `clearInteraction`: drops the recorded interaction time.
    func clearInteraction(_ id: String) { lastInteractionAt.removeValue(forKey: id) }

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
