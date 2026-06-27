import SwiftUI

struct AppToggle: View {
    let title: String
    @Binding var isOn: Bool
    @Environment(\.appTheme) private var theme

    var body: some View {
        Toggle(isOn: $isOn) {
            Text(title)
                .foregroundStyle(theme.foreground)
        }
        .tint(theme.accent)
        .toggleStyle(.switch)
    }
}
