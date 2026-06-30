import SwiftUI

/// Cmd+Shift+P fuzzy command palette. Two groups: standalone Actions + package.json scripts.
/// Ports `packages/ui/src/components/CommandPaletteDialog.tsx` (consumes only `standaloneActions`
/// and `scripts` from the run-menu data, like the TS palette).
struct CommandPaletteDialog: View {
    @Environment(AppEnvironment.self) private var env
    @Environment(\.appTheme) private var theme

    @State private var query: String = ""
    @State private var selectedIndex: Int = 0
    @FocusState private var searchFocused: Bool

    // MARK: - Owner resolution

    /// Resolved active owner (task → its project; else active project; else nil).
    /// `masterActive` is always `false` here — the palette never runs in the master workspace context.
    private var owner: (taskId: String?, projectId: String, projectPath: String?)? {
        let activeTaskId = env.tasks?.activeTaskId
        if let tid = activeTaskId,
           let task = env.tasks?.tasks.first(where: { $0.id == tid }),
           let project = env.projects?.projects.first(where: { $0.id == task.projectId }) {
            let path = ActiveWorkspace.workingDir(
                task: task, project: project, masterActive: false, homedir: env.homedir)
            return (tid, project.id, path)
        }
        if let pid = env.ui.activeProjectId,
           let project = env.projects?.projects.first(where: { $0.id == pid }) {
            return (nil, project.id, project.path)
        }
        return nil
    }

    // MARK: - Online flag (mirrors ProjectGroup.swift:43)

    private var online: Bool {
        if case .connected = env.status { return true } else { return false }
    }

    // MARK: - Groups

    private var groups: [PaletteGroup] {
        guard let owner, let runMenu = env.runMenu else { return [] }
        let defaultRuntime = env.settings?.settings?.general.defaultRuntime ?? "bun"
        let d = runMenu.data(
            projectId: owner.projectId,
            flows: env.flows?.flows ?? [],
            standaloneActions: env.flows?.actions ?? [],
            hasActiveFlowRun: false,
            defaultRuntime: defaultRuntime,
            online: online,
            showAgentOptions: false)
        return PaletteBuilder.buildGroups(
            actions: d.standaloneActions,
            scripts: d.scripts,
            online: d.online,
            defaultRuntime: d.defaultRuntime,
            query: query)
    }

    private var flatRows: [PaletteRow] { groups.flatMap(\.rows) }

    /// Clamped index safe for subscript access.
    private var activeIndex: Int { flatRows.isEmpty ? 0 : min(selectedIndex, flatRows.count - 1) }

    // MARK: - Body

    var body: some View {
        VStack(spacing: 0) {
            searchBar
            Divider().background(theme.border)
            if owner == nil {
                emptyState
            } else if flatRows.isEmpty && !query.isEmpty {
                noResults
            } else {
                resultsList
            }
            Divider().background(theme.border)
            footer
        }
        .frame(width: 560, height: 420)
        .background(theme.background)
        .onAppear {
            query = ""
            selectedIndex = 0
            searchFocused = true
            if let owner, let path = owner.projectPath {
                Task { await env.runMenu?.ensureLoaded(projectId: owner.projectId, projectPath: path) }
            }
        }
    }

    // MARK: - Sub-views

    private var searchBar: some View {
        HStack(spacing: 8) {
            Image(systemName: "magnifyingglass")
                .foregroundStyle(theme.color(.mutedForeground))
            TextField("Search actions and scripts...", text: $query)
                .textFieldStyle(.plain)
                .foregroundStyle(theme.foreground)
                .focused($searchFocused)
                .onKeyPress(.downArrow) {
                    guard !flatRows.isEmpty else { return .handled }
                    selectedIndex = (activeIndex + 1) % flatRows.count
                    return .handled
                }
                .onKeyPress(.upArrow) {
                    guard !flatRows.isEmpty else { return .handled }
                    selectedIndex = (activeIndex - 1 + flatRows.count) % flatRows.count
                    return .handled
                }
                .onKeyPress(.return) {
                    guard !flatRows.isEmpty else { return .handled }
                    run(flatRows[activeIndex])
                    return .handled
                }
                .onChange(of: query) { selectedIndex = 0 }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
    }

    private var emptyState: some View {
        VStack(spacing: 8) {
            Text("Select a task or project to run actions")
                .foregroundStyle(theme.color(.mutedForeground))
                .font(.system(size: 13))
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private var noResults: some View {
        VStack(spacing: 8) {
            Text("No results for \"\(query)\"")
                .foregroundStyle(theme.color(.mutedForeground))
                .font(.system(size: 13))
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private var resultsList: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 0) {
                    ForEach(Array(groups.enumerated()), id: \.element.id) { _, group in
                        groupHeader(group.title)
                        ForEach(Array(group.rows.enumerated()), id: \.element.id) { _, row in
                            let globalIndex = flatRows.firstIndex(where: { $0.id == row.id }) ?? 0
                            rowView(row, index: globalIndex)
                                .id(globalIndex)
                        }
                    }
                }
                .padding(.vertical, 4)
            }
            .onChange(of: activeIndex) { _, idx in
                withAnimation(.easeInOut(duration: 0.1)) {
                    proxy.scrollTo(idx, anchor: .center)
                }
            }
        }
    }

    private func groupHeader(_ title: String) -> some View {
        Text(title)
            .font(.system(size: 11, weight: .semibold))
            .foregroundStyle(theme.color(.mutedForeground))
            .padding(.horizontal, 16)
            .padding(.top, 8)
            .padding(.bottom, 2)
    }

    private func rowView(_ row: PaletteRow, index: Int) -> some View {
        let isSelected = index == activeIndex
        return HStack(spacing: 8) {
            highlightedLabel(row)
                .frame(maxWidth: .infinity, alignment: .leading)
            Text(row.detail)
                .font(.system(size: 11))
                .foregroundStyle(
                    row.disabled
                        ? theme.color(.mutedForeground).opacity(0.5)
                        : theme.color(.mutedForeground)
                )
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 7)
        .background(isSelected ? theme.color(.accent).opacity(0.15) : Color.clear)
        .contentShape(Rectangle())
        .onHover { hovered in if hovered { selectedIndex = index } }
        .onTapGesture { run(row) }
        .opacity(row.disabled ? 0.5 : 1.0)
    }

    /// Renders the row label with matched characters in bold (using `PaletteRow.indices`).
    private func highlightedLabel(_ row: PaletteRow) -> some View {
        let label = row.label
        let matchedSet = Set(row.indices)
        var result = Text("")
        for (i, ch) in label.enumerated() {
            let char = Text(String(ch))
                .font(matchedSet.contains(i)
                      ? .system(size: 13, weight: .bold)
                      : .system(size: 13, weight: .regular))
                .foregroundStyle(theme.foreground)
            result = result + char
        }
        return result
    }

    private var footer: some View {
        HStack(spacing: 12) {
            Spacer()
            Text("↑↓ navigate · ↵ run · esc close")
                .font(.system(size: 11))
                .foregroundStyle(theme.color(.mutedForeground))
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 8)
    }

    // MARK: - Action

    private func run(_ row: PaletteRow) {
        guard !row.disabled, let owner, let runMenu = env.runMenu else { return }
        let defaultRuntime = env.settings?.settings?.general.defaultRuntime ?? "bun"
        let cb = runMenu.callbacks(
            projectId: owner.projectId,
            taskId: owner.taskId,
            session: env.session,
            flows: env.flows,
            tasks: env.tasks,
            ui: env.ui,
            defaultRuntime: defaultRuntime)
        switch row.entry {
        case .action(let a): cb.onRunAction(a)
        case .script(let name): cb.onRunScript(name)
        }
        env.ui.setCommandPaletteOpen(false)
    }
}
