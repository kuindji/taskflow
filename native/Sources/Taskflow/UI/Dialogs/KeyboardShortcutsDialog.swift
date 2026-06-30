import SwiftUI

/// Static keyboard shortcuts reference sheet. Displays five hardcoded shortcut groups.
/// Port of `packages/ui/src/components/KeyboardShortcutsDialog.tsx`.
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
        ShortcutGroup(title: "Panel Navigation", rows: [
            ShortcutRow(keys: ["⌘", "⇧", "←", "→"], description: "Cycle focus between panels"),
            ShortcutRow(keys: ["⌘", "⇧", "(hold)"], description: "Hold to reveal focused panel"),
        ]),
        ShortcutGroup(title: "Workspace (when focused)", rows: [
            ShortcutRow(keys: ["⌘", "1–9"], description: "Switch to tab by number"),
        ]),
        ShortcutGroup(title: "Sidebar (when focused)", rows: [
            ShortcutRow(keys: ["⌘", "1–9"], description: "Jump to project or task by number"),
            ShortcutRow(keys: ["⌘", "0"], description: "Switch to master workspace"),
            ShortcutRow(keys: ["⌘", "↑", "↓"], description: "Navigate through items"),
            ShortcutRow(keys: ["⌘", "←"], description: "Collapse project or go to parent"),
            ShortcutRow(keys: ["⌘", "→"], description: "Expand project"),
        ]),
        ShortcutGroup(title: "File Explorer (when focused)", rows: [
            ShortcutRow(keys: ["⌘", "↑", "↓"], description: "Navigate through files and folders"),
            ShortcutRow(keys: ["⌘", "→"], description: "Expand folder or enter first child"),
            ShortcutRow(keys: ["⌘", "←"], description: "Collapse folder or go to parent"),
            ShortcutRow(keys: ["⌘", "↵"], description: "Open file or toggle folder"),
            ShortcutRow(keys: ["⌘", "Home"], description: "Jump to first item"),
            ShortcutRow(keys: ["⌘", "End"], description: "Jump to last item"),
        ]),
        ShortcutGroup(title: "General", rows: [
            ShortcutRow(keys: ["⌘", "⇧", "P"], description: "Open command palette"),
            ShortcutRow(keys: ["⌘", ","], description: "Open settings"),
            ShortcutRow(keys: ["⌘", "T"], description: "New terminal in current task or project"),
            ShortcutRow(keys: ["⌘", "J"], description: "New agent in current task or project"),
            ShortcutRow(keys: ["⌘", "N"], description: "New task"),
            ShortcutRow(keys: ["⌘", "W"], description: "Close active tab"),
            ShortcutRow(keys: ["⌘", "E"], description: "Toggle file explorer"),
            ShortcutRow(keys: ["⌘", "I"], description: "Toggle task info"),
            ShortcutRow(keys: ["⌥", "Z"], description: "Toggle editor word wrap"),
            ShortcutRow(keys: ["⌘", "⇧", "S"], description: "Toggle split workspace"),
            ShortcutRow(keys: ["⌘", "⇧", "C"], description: "Toggle compact sidebar"),
            ShortcutRow(keys: ["⌘", "(hold)"], description: "Hold to show number badges"),
            ShortcutRow(keys: ["⌘", "/"], description: "Toggle this dialog"),
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
        .frame(width: 520, height: 560)
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
