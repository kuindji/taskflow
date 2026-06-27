import SwiftUI

/// One labeled settings row: title + optional hint on the left, a trailing control on the right.
/// Port of components/settings/sections/SettingRow.tsx. The layout unit for all Phase-5 forms.
struct SettingRow<Trailing: View>: View {
    @Environment(\.appTheme) private var theme
    private let label: String
    private let hint: String?
    private let trailing: () -> Trailing

    init(label: String, hint: String? = nil, @ViewBuilder trailing: @escaping () -> Trailing) {
        self.label = label
        self.hint = hint
        self.trailing = trailing
    }

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            VStack(alignment: .leading, spacing: 2) {
                Text(label)
                    .font(.system(size: 13, weight: .medium))
                    .foregroundStyle(theme.color(.foreground))
                if let hint {
                    Text(hint)
                        .font(.system(size: 11))
                        .foregroundStyle(theme.color(.mutedForeground))
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            Spacer(minLength: 12)
            trailing().frame(alignment: .trailing)
        }
        .padding(.vertical, 6)
    }
}
