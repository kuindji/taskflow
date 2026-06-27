import SwiftUI
import UniformTypeIdentifiers

// MARK: - Drag payload

extension UTType {
    /// Custom UTType for intra-app tab drag-and-drop.
    /// `sourceKey` lets the drop target distinguish same-pane reorder (Task 10)
    /// from cross-pane move (Task 11).
    static let taskflowTab = UTType(exportedAs: "com.taskflow.tab")
}

/// Transfer payload carried by a dragged tab.
/// `Codable` drives the `CodableRepresentation`; `Sendable` satisfies Swift 6 strict concurrency.
struct TabDragItem: Codable, Transferable, Sendable {
    let tabId: String
    let sourceKey: String

    static var transferRepresentation: some TransferRepresentation {
        CodableRepresentation(contentType: .taskflowTab)
    }
}

// MARK: - TabItem

/// One draggable tab chip in the workspace tab bar.
///
/// Visual spec mirrors `TabItem.tsx` + `tab-constants.ts`:
/// - Foreground color is type-coded (warning / success / primary / info / muted-foreground …).
/// - Active chip has `theme.muted` background; inactive is transparent.
/// - Status dot (6 pt circle) appears when `tab.sessionId != nil`; colored by session status.
/// - Close ×-button on the right; tap on the chip body calls `onSelect`.
///
/// Drag: emits a `TabDragItem` carrying `tabId` + `workspaceKey` (= `sourceKey`).
/// Drop: accepts `TabDragItem`; when `sourceKey == workspaceKey` (same pane), calls
///       `session.reorderTabs(workspaceKey, activeId: dropped.tabId, overId: tab.id)`.
///       Cross-pane handling (`sourceKey != workspaceKey`) is wired in Task 11.
struct TabItem: View {
    let tab: Tab
    let isActive: Bool
    let workspaceKey: String
    let onSelect: () -> Void
    let onClose: () -> Void

    @Environment(AppEnvironment.self) private var env
    @Environment(\.appTheme) private var theme

    var body: some View {
        HStack(spacing: 3) {
            if tab.sessionId != nil {
                statusDot
            }
            Text(tab.label)
                .font(.system(size: 13))
                .lineLimit(1)
                .fixedSize()
            closeButton
        }
        .padding(.horizontal, 6)
        .frame(height: 24)
        .foregroundStyle(typeColor)
        .background(isActive ? theme.muted : Color.clear)
        .clipShape(RoundedRectangle(cornerRadius: 6))
        .contentShape(RoundedRectangle(cornerRadius: 6))
        .onTapGesture { onSelect() }
        .draggable(TabDragItem(tabId: tab.id, sourceKey: workspaceKey))
        .dropDestination(for: TabDragItem.self) { items, _ in
            guard let dropped = items.first,
                  dropped.sourceKey == workspaceKey,
                  dropped.tabId != tab.id
            else { return false }
            env.session?.reorderTabs(workspaceKey, activeId: dropped.tabId, overId: tab.id)
            return true
        }
    }

    // MARK: - Sub-views

    private var statusDot: some View {
        Circle()
            .fill(dotColor)
            .frame(width: 6, height: 6)
    }

    private var closeButton: some View {
        Button(action: onClose) {
            Image(systemName: "xmark")
                .font(.system(size: 9, weight: .medium))
                .frame(width: 18, height: 18)
                .opacity(0.5)
        }
        .buttonStyle(.plain)
    }

    // MARK: - Color helpers

    /// Foreground color by tab type — direct port of `tab-constants.ts` `tabVariants.type`.
    private var typeColor: Color {
        switch tab.type {
        case .claude:   return theme.warning
        case .codex:    return theme.success
        // No `--opencode` CSS variable in the base theme contract; accent is the nearest semantic fit.
        case .opencode: return theme.accent
        case .gemini:   return theme.primary
        case .cursor:   return theme.color(.cursorAgent)
        case .pi:       return theme.primary
        case .shell:    return theme.color(.info)
        case .editor, .changes, .browser, .markdown:
            return theme.color(.mutedForeground)
        }
    }

    /// Status-dot fill — mirrors the Electron `StatusDot` component's color mapping.
    private var dotColor: Color {
        guard let sessionId = tab.sessionId,
              let status = env.session?.sessionStatus[sessionId]
        else { return theme.color(.mutedForeground) }
        switch status {
        case .working:      return theme.success
        case .attention:    return theme.warning
        case .initializing: return theme.color(.info)
        }
    }
}
