import SwiftUI

/// Horizontal tab bar for one workspace pane.
///
/// Behavioral parity with `TabBar.tsx` + `TabItem.tsx`:
/// - Renders `session.tabs(workspaceKey)` in an HStack inside a horizontal ScrollView.
/// - Tap on a chip → `session.setActiveTab(workspaceKey, tabId)`.
/// - Drag activation is handled by SwiftUI's built-in `.draggable()` sensor (no explicit
///   5-pt threshold needed; the system's drag-initiation latency is comparable).
/// - Same-pane reorder: each `TabItem` carries a `.dropDestination(for: TabDragItem.self)`;
///   when the dropped item's `sourceKey == workspaceKey`, it calls
///   `session.reorderTabs(workspaceKey, activeId:overId:)` — mirroring `handleDragEnd` in
///   `TabBar.tsx` which fires `onTabReorder(active.id, over.id)` → `reorderTabs`.
/// - Close: `session.closeTab` is async; dispatched via a detached Task.
struct TabBar: View {
    let workspaceKey: String

    @Environment(AppEnvironment.self) private var env
    @Environment(\.appTheme) private var theme

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 4) {
                ForEach(currentTabs) { tab in
                    TabItem(
                        tab: tab,
                        isActive: tab.id == activeTabId,
                        workspaceKey: workspaceKey,
                        onSelect: {
                            env.session?.setActiveTab(workspaceKey, tab.id)
                        },
                        onClose: {
                            guard let session = env.session else { return }
                            Task { @MainActor in
                                await session.closeTab(workspaceKey, tab.id)
                            }
                        }
                    )
                }
            }
            .padding(.horizontal, 6)
            .padding(.vertical, 6)
        }
        .frame(height: 36)   // h-9 in Tailwind = 36 pt
        .background(theme.color(.card))
    }

    // MARK: - Helpers

    private var currentTabs: [Tab] {
        env.session?.tabs(workspaceKey) ?? []
    }

    private var activeTabId: String? {
        env.session?.activeTabByWorkspace[workspaceKey]
    }
}
