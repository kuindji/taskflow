import SwiftUI

/// Inline session chip: type label + status dot. Port of components/sidebar/SessionBadge.tsx
/// + components/ui/status-dot.tsx.
struct SessionBadge: View {
    @Environment(\.appTheme) private var theme
    @Environment(AppEnvironment.self) private var env
    private let session: SessionRef
    init(_ session: SessionRef) { self.session = session }

    private var status: SessionStatus? { env.session?.sessionStatus[session.id] }

    var body: some View {
        HStack(spacing: 2) {
            StatusDot(status: status)
            Text(session.type).font(.system(size: 10))
        }
        .padding(.horizontal, 4).padding(.vertical, 1)
        .overlay(RoundedRectangle(cornerRadius: 4)
            .stroke(theme.color(Self.colorToken(forType: session.type)).opacity(0.5), lineWidth: 1))
        .foregroundStyle(theme.color(Self.colorToken(forType: session.type)))
    }

    /// Status dot: success/warning/muted for working/attention/initializing; nothing when nil.
    struct StatusDot: View {
        @Environment(\.appTheme) private var theme
        let status: SessionStatus?
        var body: some View {
            if let token = SessionBadge.dotToken(for: status) {
                Circle().fill(theme.color(token)).frame(width: 6, height: 6)
            }
        }
    }

    nonisolated static func colorToken(forType type: String) -> ThemeToken {
        switch type {
        case "claude": return .primary
        case "cursor": return .cursorAgent
        case "shell": return .mutedForeground
        default: return .foreground   // includes "codex"
        }
    }
    nonisolated static func dotToken(for status: SessionStatus?) -> ThemeToken? {
        switch status {
        case .working: return .success
        case .attention: return .warning
        case .initializing: return .mutedForeground
        case nil: return nil
        }
    }
}
