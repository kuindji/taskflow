import SwiftUI

// Port of packages/ui/src/components/appearance/ThemeCard.tsx
struct ThemeCard: View {
    let record: ThemeRecord
    let isActive: Bool
    let onTap: () -> Void
    @Environment(\.appTheme) private var theme

    private var c: ThemeColors { record.source.colors }

    var body: some View {
        Button(action: onTap) {
            VStack(alignment: .leading, spacing: 6) {
                // Preview pane
                HStack(spacing: 4) {
                    Text("~/project $").foregroundStyle(Color(hex: c.foreground))
                    Text("git status").foregroundStyle(Color(hex: c.ansi.green))
                }
                .font(.system(size: 11, design: .monospaced))
                .frame(maxWidth: .infinity, alignment: .leading)
                .frame(height: 64)
                .padding(8)
                .background(Color(hex: c.background))
                // Swatch row: red, green, yellow, blue, magenta, cyan
                let swatches = [c.ansi.red, c.ansi.green, c.ansi.yellow, c.ansi.blue, c.ansi.magenta, c.ansi.cyan]
                HStack(spacing: 0) {
                    ForEach(Array(swatches.enumerated()), id: \.offset) { _, hex in
                        Rectangle().fill(Color(hex: hex)).frame(height: 12)
                    }
                }
                .clipShape(RoundedRectangle(cornerRadius: 2))
                Text(record.source.name).font(.system(size: 12, weight: .medium))
            }
            .padding(8)
            .background(isActive ? theme.accent.opacity(0.1) : .clear)
            .overlay(
                RoundedRectangle(cornerRadius: 8)
                    .stroke(isActive ? theme.accent : theme.border, lineWidth: isActive ? 2 : 1)
            )
        }
        .buttonStyle(.plain)
    }
}
