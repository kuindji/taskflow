import SwiftUI

/// Split workspace container — port of `packages/ui/src/components/workspace/SplitContainer.tsx`.
///
/// **Layout:**
/// - Split closed (`ui.getSplit(workspaceKey)?.open != true`): single pane
///   (TabBar + PaneHost for `workspaceKey`).
/// - Split open: `HStack(spacing: 0)` of:
///     left pane  (`workspaceKey`,                    `width = totalWidth × ratio`)
///     vertical `ResizeHandle`  → `ui.setSplitRatio`
///     right pane (`WorkspaceKey.right(workspaceKey)`, fills remainder)
///
/// **Open-state contract (UIViewModel Task 4):**
/// Use `getSplit(key)?.open == true` — NOT `!= nil`.
/// A closed split retains its dictionary entry with `open = false`.
///
/// **Cross-pane drop routing:**
/// Each pane (TabBar + PaneHost body) is wrapped in a
/// `.dropDestination(for: TabDragItem.self)`:
/// - `dropped.sourceKey == paneKey` → return `false` (no-op; `TabItem` handles same-pane
///   reorder in Task 10 and returns `true` first, so this guard is an extra safety net).
/// - `dropped.sourceKey != paneKey` → cross-pane move via
///   `session.moveTabToPane(source:target:tabId:)` then
///   `ui.setActivePane(workspaceKey, targetPane)`.
///
/// **Parity with `SplitContainer.tsx`:**
/// - `handleResize` : `delta / containerWidth` added to current ratio (read live from store)
/// - `handleDragEnd`: pane-body drop fires `moveTabToPane` for cross-pane; same-pane handled
///   by `TabItem`. In SwiftUI `dropDestination` precedence: the inner `TabItem` fires first and
///   returns `true` for same-pane drops; if it returns `false` (cross-pane), SwiftUI falls
///   through to the outer pane wrapper — exactly the routing we want.
struct SplitContainer: View {
    let workspaceKey: String

    @Environment(AppEnvironment.self) private var env
    @Environment(\.appTheme) private var theme

    var body: some View {
        let isOpen = env.ui.getSplit(workspaceKey)?.open == true
        let ratio  = env.ui.getSplit(workspaceKey)?.ratio ?? 0.5

        ZStack(alignment: .topTrailing) {
            if isOpen {
                GeometryReader { geo in
                    let totalWidth = geo.size.width
                    HStack(spacing: 0) {
                        paneView(for: workspaceKey)
                            .frame(width: max(1, totalWidth * ratio))

                        ResizeHandle(orientation: .vertical) { delta in
                            guard totalWidth > 0 else { return }
                            // Always read the live ratio from the store — not the captured `ratio`
                            // constant — so rapid drags accumulate correctly.
                            let current = env.ui.getSplit(workspaceKey)?.ratio ?? ratio
                            env.ui.setSplitRatio(workspaceKey, current + delta / totalWidth)
                        } onEnded: {}

                        paneView(for: WorkspaceKey.right(workspaceKey))
                            .frame(maxWidth: .infinity)
                    }
                }
            } else {
                paneView(for: workspaceKey)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            }

            splitToggleButton(isOpen: isOpen)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    // MARK: - Pane view

    /// Renders a single pane: `TabBar → Divider → PaneHost`, wrapped in a cross-pane
    /// drop target. Same-pane drops return `false` (handled by `TabItem`).
    private func paneView(for paneKey: String) -> some View {
        VStack(spacing: 0) {
            TabBar(workspaceKey: paneKey)
            Divider()
                .background(theme.border)
            PaneHost(activeTab: env.session?.activeTab(paneKey), workspaceKey: paneKey)
        }
        .clipShape(RoundedRectangle(cornerRadius: 6))
        .dropDestination(for: TabDragItem.self) { items, _ in
            // Guard: same-pane drops are handled by TabItem (reorder). Don't double-process.
            guard let dropped = items.first,
                  dropped.sourceKey != paneKey
            else { return false }

            // Cross-pane move: remove from source, append to target, activate target pane.
            env.session?.moveTabToPane(
                source: dropped.sourceKey,
                target: paneKey,
                tabId: dropped.tabId
            )
            let targetPane: PaneId = WorkspaceKey.isRight(paneKey) ? .right : .left
            env.ui.setActivePane(workspaceKey, targetPane)
            return true
        }
    }

    // MARK: - Split toggle button

    /// Small toolbar button that opens / closes the split.
    /// Positioned at the top-right corner of the container as an overlay.
    /// The right side of the tab row is typically empty of chips, so overlap is minimal.
    private func splitToggleButton(isOpen: Bool) -> some View {
        Button {
            env.ui.toggleSplit(workspaceKey)
        } label: {
            Image(systemName: "rectangle.split.2x1")
                .font(.system(size: 11))
                .foregroundStyle(
                    isOpen ? theme.primary : theme.foreground.opacity(0.45)
                )
                .frame(width: 24, height: 24)
                .background(
                    isOpen ? theme.primary.opacity(0.15) : theme.muted.opacity(0.35)
                )
                .clipShape(RoundedRectangle(cornerRadius: 4))
        }
        .buttonStyle(.plain)
        .padding(.trailing, 8)
        .padding(.top, 6)
        // Sit above the drop-destination regions.
        .zIndex(10)
        #if DEBUG
        // Cmd+\ triggers the split toggle in dev builds — used by automated screenshot tooling
        // that cannot reliably click small buttons in non-AppleScript-accessible native windows.
        .keyboardShortcut("\\", modifiers: .command)
        // Cmd+Shift+[ / ] nudge the split ratio for screenshot evidence (divider-resized).
        .background(
            Group {
                Button("") { env.ui.setSplitRatio(workspaceKey, 0.3) }
                    .keyboardShortcut("[", modifiers: [.command, .shift])
                Button("") { env.ui.setSplitRatio(workspaceKey, 0.7) }
                    .keyboardShortcut("]", modifiers: [.command, .shift])
            }
        )
        #endif
    }
}
