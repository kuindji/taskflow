import SwiftUI

/// Temporary pane content host for Phase 3.
///
/// Shows the active tab's label and type so Tasks 10 and 11 are verifiable without
/// the real terminal / editor / browser panes that are implemented in Phase 4.
struct PanePlaceholder: View {
    let activeTab: Tab?

    /// Convenience init matching the call site: `PanePlaceholder(for: session.activeTab(key))`.
    init(for tab: Tab?) {
        self.activeTab = tab
    }

    @Environment(\.appTheme) private var theme

    var body: some View {
        ZStack {
            RoundedRectangle(cornerRadius: 6)
                .fill(theme.color(.card))
            if let tab = activeTab {
                VStack(spacing: 8) {
                    Text(tab.label)
                        .font(.title2)
                        .fontWeight(.light)
                        .foregroundStyle(theme.foreground.opacity(0.5))
                    Text(tab.type.rawValue)
                        .font(.caption)
                        .foregroundStyle(theme.foreground.opacity(0.3))
                        .padding(.horizontal, 8)
                        .padding(.vertical, 4)
                        .background(theme.muted.opacity(0.6))
                        .clipShape(RoundedRectangle(cornerRadius: 4))
                }
            } else {
                Text("No active tab")
                    .font(.caption2)
                    .foregroundStyle(theme.foreground.opacity(0.2))
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}
