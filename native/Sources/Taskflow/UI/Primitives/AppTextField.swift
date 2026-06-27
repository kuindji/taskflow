import SwiftUI

struct AppTextField: View {
    @Binding var text: String
    var placeholder: String = "Type here..."
    @Environment(\.appTheme) private var theme

    var body: some View {
        TextField(placeholder, text: $text)
            .textFieldStyle(.plain)
            .padding(.horizontal, 10)
            .padding(.vertical, 6)
            .foregroundStyle(theme.foreground)
            .background(theme.background)
            .overlay(
                RoundedRectangle(cornerRadius: 6)
                    .stroke(theme.border, lineWidth: 1)
            )
    }
}
