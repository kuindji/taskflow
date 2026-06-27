import SwiftUI

/// Themed monogram for an agent type. Placeholder for pixel-faithful brand glyphs
/// (components/icons/*Icon.tsx) — swap the body for bundled vector assets when available.
struct AgentIcon: View {
    @Environment(\.appTheme) private var theme
    private let agent: AgentType
    private let size: CGFloat

    init(_ agent: AgentType, size: CGFloat = 16) {
        self.agent = agent
        self.size = size
    }

    /// Single-glyph monogram, chosen so the six agents are visually distinct.
    /// Marked nonisolated so tests can call it synchronously without actor-hopping.
    nonisolated static func initial(for agent: AgentType) -> String {
        switch agent {
        case .claude: return "C"
        case .codex: return "X"
        case .opencode: return "O"
        case .gemini: return "G"
        case .cursor: return "▶"
        case .pi: return "π"
        }
    }

    /// Marked nonisolated so tests can call it synchronously without actor-hopping.
    nonisolated static func tintToken(for agent: AgentType) -> ThemeToken {
        switch agent {
        case .claude: return .primary
        case .codex: return .foreground
        case .opencode: return .info
        case .gemini: return .accent
        case .cursor: return .cursorAgent
        case .pi: return .success
        }
    }

    var body: some View {
        Text(Self.initial(for: agent))
            .font(.system(size: size * 0.6, weight: .semibold))
            .foregroundStyle(theme.color(.background))
            .frame(width: size, height: size)
            .background(theme.color(Self.tintToken(for: agent)))
            .clipShape(RoundedRectangle(cornerRadius: size * 0.25))
    }
}
