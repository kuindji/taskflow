import SwiftUI

/// Search/replace panel. Port of `packages/ui/src/components/panels/SearchPanel.tsx`.
/// Debounces 300ms and only searches for queries ≥ 3 chars (matching the TS panel).
struct SearchPane: View {
    @Environment(\.appTheme) private var theme
    @Environment(AppEnvironment.self) private var env
    @State private var showFilters = false
    @State private var debounce: Task<Void, Never>?

    private var search: SearchViewModel? { env.search }

    // Same working-dir derivation as FileExplorerPane (shared helper).
    private var workingDir: String? { ActiveWorkspace.workingDir(in: env) }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            if let search {
                @Bindable var s = search
                HStack(spacing: 4) {
                    AppTextField(text: $s.query, placeholder: "Search")
                        .onChange(of: search.query) { _, _ in scheduleSearch() }
                        .onSubmit { runSearch() }
                    flag("CaseSensitive", on: search.caseSensitive) { search.toggleCaseSensitive(); scheduleSearch() }
                    flag("WholeWord", on: search.wholeWord) { search.toggleWholeWord(); scheduleSearch() }
                    flag("Regex", on: search.useRegex) { search.toggleUseRegex(); scheduleSearch() }
                }
                HStack(spacing: 4) {
                    AppTextField(text: $s.replacement, placeholder: "Replace")
                    AppButton(title: "Replace All", kind: .secondary) {
                        if let wd = workingDir { Task { await search.replaceAll(rootPath: wd, filePath: nil) } }
                    }
                    .disabled(search.results.isEmpty)
                    Button { showFilters.toggle() } label: { AppIcon("Filter") }.buttonStyle(.plain)
                }
                if showFilters {
                    AppTextField(text: $s.includePattern, placeholder: "files to include (e.g. *.ts)")
                        .onChange(of: search.includePattern) { _, _ in scheduleSearch() }
                    AppTextField(text: $s.excludePattern, placeholder: "files to exclude")
                        .onChange(of: search.excludePattern) { _, _ in scheduleSearch() }
                }
                if let wd = workingDir {
                    SearchResultsView(rootPath: wd)
                } else {
                    Text("Select a task or project")
                        .foregroundStyle(theme.foreground.opacity(0.35)).font(.caption)
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                }
            }
        }
        .padding(6)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .background(theme.color(.card))
        .clipShape(RoundedRectangle(cornerRadius: 6))
    }

    private func flag(_ icon: String, on: Bool, _ act: @escaping () -> Void) -> some View {
        Button(action: act) { AppIcon(icon) }
            .buttonStyle(.plain)
            .padding(3)
            .background(on ? theme.color(.accent).opacity(0.25) : Color.clear)
            .clipShape(RoundedRectangle(cornerRadius: 4))
    }

    /// Debounced auto-search (300ms, ≥3 chars), mirroring SearchPanel.tsx.
    private func scheduleSearch() {
        debounce?.cancel()
        debounce = Task {
            try? await Task.sleep(for: .milliseconds(300))
            if Task.isCancelled { return }
            runSearch()
        }
    }

    private func runSearch() {
        guard let wd = workingDir, let search, search.query.count >= 3 else { return }
        Task { await search.search(rootPath: wd) }
    }
}
