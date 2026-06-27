import SwiftUI

struct AppBadge: View {
    let text: String
    @Environment(\.appTheme) private var theme

    var body: some View {
        Text(text)
            .font(.caption)
            .fontWeight(.medium)
            .padding(.horizontal, 8)
            .padding(.vertical, 2)
            .foregroundStyle(theme.background)
            .background(theme.accent)
            .clipShape(Capsule())
    }
}
