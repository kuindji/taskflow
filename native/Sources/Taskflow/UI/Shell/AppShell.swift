import SwiftUI

/// 6-pane app shell — port of `packages/ui/src/components/AppShell.tsx`.
///
/// Pane map (left → right):
///   sidebar (always) | [file-explorer OR search (conditional)] | [flow-panel (conditional)]
///   | workspace (fills) | [task-info (conditional)]
///
/// Widths are read from `UIViewModel` and written back through its clamping setters.
/// `ResizeHandle` between each adjacent pair emits incremental deltas; on drag-end the current
/// widths are persisted via `settings.updateSettings`, mirroring `handleResizeEnd` in AppShell.tsx.
///
/// Note: file-explorer and search-panel are mutually exclusive (toggled via UIViewModel).
/// Phase 4 will replace the placeholder panels with real content views.
struct AppShell: View {
    @Environment(AppEnvironment.self) private var env
    @Environment(\.appTheme) private var theme

    var body: some View {
        let ui = env.ui
        HStack(spacing: 0) {

            // ── Sidebar (always visible) ───────────────────────────────
            SidebarView()
                .frame(width: ui.sidebarWidth)
                .clipShape(RoundedRectangle(cornerRadius: 6))

            ResizeHandle(orientation: .vertical) { delta in
                env.ui.setSidebarWidth(env.ui.sidebarWidth + delta)
            } onEnded: {
                persistLayout()
            }

            // ── File explorer / search (mutually exclusive, conditional) ─
            if ui.fileExplorerOpen || ui.searchPanelOpen {
                Group {
                    if ui.fileExplorerOpen {
                        FileExplorerPane()
                    } else {
                        SearchPane()
                    }
                }
                .frame(width: ui.fileExplorerWidth)

                ResizeHandle(orientation: .vertical) { delta in
                    env.ui.setFileExplorerWidth(env.ui.fileExplorerWidth + delta)
                } onEnded: {
                    persistLayout()
                }
            }

            // ── Flow panel (conditional) ───────────────────────────────
            if ui.flowPanelOpen {
                panelPlaceholder("Flow Panel", width: ui.flowPanelWidth)

                ResizeHandle(orientation: .vertical) { delta in
                    env.ui.setFlowPanelWidth(env.ui.flowPanelWidth + delta)
                } onEnded: {
                    persistLayout()
                }
            }

            // ── Workspace (flexible — fills remaining space) ───────────
            WorkspaceView()
                .frame(maxWidth: .infinity)

            // ── Task info (conditional) — handle is on the LEFT of the panel.
            // Dragging right DECREASES taskInfo width, so delta is negated.
            // Mirrors `handleTaskInfoResize: delta => setTaskInfoWidth(current - delta)`.
            if ui.taskInfoOpen {
                ResizeHandle(orientation: .vertical) { delta in
                    env.ui.setTaskInfoWidth(env.ui.taskInfoWidth - delta)
                } onEnded: {
                    persistLayout()
                }

                panelPlaceholder("Task Info", width: ui.taskInfoWidth)
            }
        }
        .padding(ui.panelGap)
        .background(theme.background)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .sheet(isPresented: Binding(
            get: { ui.flowManagementOpen },
            set: { if !$0 { env.ui.toggleFlowManagement() } }
        )) {
            FlowManagementDialog()
        }
        .sheet(isPresented: Binding(
            get: { ui.scheduleManagementOpen },
            set: { if !$0 { env.ui.toggleScheduleManagement() } }
        )) {
            ScheduleManagementDialog()
        }
        .sheet(isPresented: Binding(
            get: { ui.settingsOpen },
            set: { if !$0 { env.ui.toggleSettings() } }
        )) {
            SettingsDialog()
        }
    }

    // MARK: - Helpers

    /// Placeholder panel used for panes whose real content is implemented in later tasks.
    private func panelPlaceholder(_ label: String, width: Double) -> some View {
        ZStack {
            RoundedRectangle(cornerRadius: 6)
                .fill(theme.color(.card))
            Text(label)
                .foregroundStyle(theme.foreground.opacity(0.35))
                .font(.caption)
        }
        .frame(width: width)
    }

    /// Mirrors `handleResizeEnd` from AppShell.tsx — persists the current four panel widths
    /// via `settings.updateSettings`. Runs async on @MainActor so the task can access
    /// the @MainActor-isolated SettingsViewModel.
    private func persistLayout() {
        let ui = env.ui
        let patch = LayoutWidthPatch(
            layout: .init(panels: .init(
                sidebarWidth:      ui.sidebarWidth,
                fileExplorerWidth: ui.fileExplorerWidth,
                taskInfoWidth:     ui.taskInfoWidth,
                flowPanelWidth:    ui.flowPanelWidth
            ))
        )
        guard let settings = env.settings else { return }
        Task { await settings.updateSettings(patch) }
    }
}

// MARK: - Typed patch structs for layout persistence

/// Mirrors the `{ layout: { panels: { sidebarWidth, fileExplorerWidth, taskInfoWidth, flowPanelWidth } } }`
/// shape that `AppShell.tsx`'s `handleResizeEnd` sends to `updateSettings`.
/// A partial-panel struct is used (not `PanelSettings`) because the server accepts a subset
/// of panel fields; `PanelSettings` includes fields like `compactSidebar` we don't touch here.
private struct PanelWidthPatch: Encodable {
    let sidebarWidth: Double
    let fileExplorerWidth: Double
    let taskInfoWidth: Double
    let flowPanelWidth: Double
}

private struct LayoutPanelsPatch: Encodable {
    let panels: PanelWidthPatch
}

private struct LayoutWidthPatch: Encodable {
    let layout: LayoutPanelsPatch
}
