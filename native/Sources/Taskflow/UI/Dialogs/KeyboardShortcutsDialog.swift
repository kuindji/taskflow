import SwiftUI

/// Static keyboard shortcuts reference sheet for shortcuts currently wired in the native app.
struct KeyboardShortcutsDialog: View {
    @Environment(AppEnvironment.self) private var env
    @Environment(\.appTheme) private var theme

    // MARK: - Types

    private struct ShortcutRow {
        let keys: [String]
        let description: String
    }

    private struct ShortcutGroup {
        let title: String
        let rows: [ShortcutRow]
    }

    // MARK: - Data

    private let shortcutGroups: [ShortcutGroup] = [
        ShortcutGroup(title: "Sidebar (when focused)", rows: [
            ShortcutRow(keys: ["⌘", "0"], description: "Switch to master workspace"),
            ShortcutRow(keys: ["⌘", "↑", "↓"], description: "Navigate through items"),
            ShortcutRow(keys: ["⌘", "←"], description: "Collapse project or go to parent"),
            ShortcutRow(keys: ["⌘", "→"], description: "Expand project"),
        ]),
        ShortcutGroup(title: "General", rows: [
            ShortcutRow(keys: ["⌘", "⇧", "P"], description: "Open command palette"),
            ShortcutRow(keys: ["⌘", "/"], description: "Toggle keyboard shortcuts"),
            ShortcutRow(keys: ["⌘", "N"], description: "New task"),
            ShortcutRow(keys: ["⌘", ","], description: "Open settings"),
        ]),
    ]

    // MARK: - Body

    var body: some View {
        VStack(spacing: 0) {
            header
            Divider()
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    ForEach(shortcutGroups, id: \.title) { group in
                        groupView(group)
                    }
                }
                .padding(16)
            }
        }
        .frame(width: 520, height: 360)
        .background(theme.background)
    }

    // MARK: - Header

    private var header: some View {
        HStack {
            Text("Keyboard Shortcuts")
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(theme.foreground)
            Spacer()
            Button {
                env.ui.setShortcutsDialogOpen(false)
            } label: {
                AppIcon("X").font(.system(size: 13))
            }
            .buttonStyle(.plain)
            .foregroundStyle(theme.foreground.opacity(0.6))
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
    }

    // MARK: - Group view

    private func groupView(_ group: ShortcutGroup) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(group.title)
                .font(.system(size: 12, weight: .semibold))
                .foregroundStyle(theme.foreground.opacity(0.7))
            VStack(spacing: 6) {
                ForEach(group.rows, id: \.description) { row in
                    rowView(row)
                }
            }
        }
    }

    // MARK: - Row view

    private func rowView(_ row: ShortcutRow) -> some View {
        HStack(spacing: 12) {
            Text(row.description)
                .font(.system(size: 13))
                .foregroundStyle(theme.foreground)
            Spacer()
            HStack(spacing: 4) {
                ForEach(row.keys, id: \.self) { key in
                    Text(key)
                        .font(.system(size: 11))
                        .foregroundStyle(theme.foreground)
                        .padding(.horizontal, 6)
                        .padding(.vertical, 3)
                        .background(theme.muted)
                        .clipShape(RoundedRectangle(cornerRadius: 4))
                }
            }
        }
    }
}
