import SwiftUI

struct AppSegmentedTabs: View {
    @Binding var selection: Int
    let titles: [String]
    @Environment(\.appTheme) private var theme

    var body: some View {
        HStack(spacing: 0) {
            ForEach(titles.indices, id: \.self) { i in
                Button {
                    selection = i
                } label: {
                    Text(titles[i])
                        .padding(.horizontal, 14)
                        .padding(.vertical, 6)
                        .foregroundStyle(selection == i ? theme.background : theme.foreground)
                        .background(selection == i ? theme.primary : Color.clear)
                }
                .buttonStyle(.plain)
            }
        }
        .background(theme.muted.opacity(0.4))
        .clipShape(RoundedRectangle(cornerRadius: 6))
        .overlay(
            RoundedRectangle(cornerRadius: 6)
                .stroke(theme.border, lineWidth: 1)
        )
    }
}
