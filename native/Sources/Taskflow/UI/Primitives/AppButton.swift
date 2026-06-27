import SwiftUI

struct AppButton: View {
    enum Kind { case primary, secondary, destructive }
    let title: String
    var kind: Kind = .primary
    let action: () -> Void
    @Environment(\.appTheme) private var theme

    var body: some View {
        Button(action: action) {
            Text(title)
                .padding(.horizontal, 12).padding(.vertical, 6)
                .foregroundStyle(foreground)
                .background(background)
                .clipShape(RoundedRectangle(cornerRadius: 6))
        }
        .buttonStyle(.plain)
    }

    private var background: Color {
        switch kind {
        case .primary: return theme.primary
        case .secondary: return theme.muted
        case .destructive: return theme.destructive
        }
    }
    private var foreground: Color { theme.background }
}
