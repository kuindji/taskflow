import SwiftUI

/// Themed Menu wrapper. Use for contextual action menus.
struct AppMenu<Content: View>: View {
    let title: String
    @ViewBuilder let content: () -> Content
    @Environment(\.appTheme) private var theme

    var body: some View {
        Menu {
            content()
        } label: {
            Text(title)
                .padding(.horizontal, 12)
                .padding(.vertical, 6)
                .foregroundStyle(theme.foreground)
                .background(theme.muted.opacity(0.6))
                .clipShape(RoundedRectangle(cornerRadius: 6))
                .overlay(
                    RoundedRectangle(cornerRadius: 6)
                        .stroke(theme.border, lineWidth: 1)
                )
        }
        .menuStyle(.borderlessButton)
    }
}
