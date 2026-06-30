import SwiftUI

/// Dialog for forking a project into a new git worktree branch.
/// Port of `packages/ui/src/components/workspace/ForkProjectDialog.tsx`.
struct ForkProjectDialog: View {

    // MARK: - Props

    let isPresented: Binding<Bool>
    let project: Project

    // MARK: - Environment

    @Environment(AppEnvironment.self) private var env
    @Environment(\.appTheme) private var theme

    // MARK: - State

    @State private var branch: String = ""
    @State private var folder: String = ""
    @State private var customFolder: Bool = false
    @State private var loading: Bool = false
    @State private var error: String?
    @FocusState private var branchFocused: Bool

    // MARK: - Pure helpers (testable)

    /// Lowercases `s`, replaces `/` and whitespace with `-`, strips characters not in `[a-z0-9-.]`.
    nonisolated static func slugify(_ s: String) -> String {
        let lowered = s.lowercased()
        var result = ""
        for ch in lowered {
            if ch == "/" || ch.isWhitespace {
                result.append("-")
            } else if ch.isLetter || ch.isNumber || ch == "-" || ch == "." {
                result.append(ch)
            }
            // else: strip disallowed characters
        }
        return result
    }

    /// Returns the parent directory of `path` (last `/`-component dropped, no trailing slash).
    nonisolated static func parentDir(_ path: String) -> String {
        guard let lastSlash = path.lastIndex(of: "/"), lastSlash != path.startIndex else {
            return path
        }
        return String(path[path.startIndex..<lastSlash])
    }

    // MARK: - Derived

    private var targetPath: String {
        Self.parentDir(project.path) + "/" + folder
    }

    /// Custom binding for the folder field that marks user-driven edits as custom.
    private var folderBinding: Binding<String> {
        Binding(
            get: { folder },
            set: { newVal in
                customFolder = true
                folder = newVal
            }
        )
    }

    private var canSubmit: Bool {
        !branch.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            && !folder.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            && !loading
    }

    // MARK: - Body

    var body: some View {
        VStack(spacing: 0) {
            header
            Divider()
            content
            Divider()
            footer
        }
        .frame(width: 440)
        .background(theme.background)
        .clipShape(RoundedRectangle(cornerRadius: 12))
        .onAppear { branchFocused = true }
    }

    // MARK: - Header

    private var header: some View {
        HStack {
            Text("Fork Project")
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(theme.foreground)
            Spacer()
            Button {
                isPresented.wrappedValue = false
            } label: {
                AppIcon("X").font(.system(size: 13))
            }
            .buttonStyle(.plain)
            .foregroundStyle(theme.foreground.opacity(0.6))
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
    }

    // MARK: - Content

    private var content: some View {
        VStack(alignment: .leading, spacing: 16) {
            fieldGroup(label: "Branch name") {
                AppTextField(text: $branch, placeholder: "feature/my-branch")
                    .focused($branchFocused)
                    .onChange(of: branch) { _, newValue in
                        if !customFolder {
                            folder = Self.slugify(newValue)
                        }
                    }
            }

            fieldGroup(label: "Folder name (optional)") {
                AppTextField(text: folderBinding, placeholder: Self.slugify("feature/my-branch"))
                if !folder.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                    Text(targetPath)
                        .font(.system(size: 11, design: .monospaced))
                        .foregroundStyle(theme.foreground.opacity(0.55))
                        .lineLimit(2)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }

            if let errorText = error {
                Text(errorText)
                    .font(.system(size: 12))
                    .foregroundStyle(theme.color(.destructive))
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .padding(20)
    }

    // MARK: - Footer

    private var footer: some View {
        HStack(spacing: 8) {
            Spacer()
            AppButton(title: "Cancel", kind: .secondary) {
                isPresented.wrappedValue = false
            }
            AppButton(title: loading ? "Forking…" : "Fork Project", action: submit)
                .keyboardShortcut(.return, modifiers: .command)
                .disabled(!canSubmit)
        }
        .padding(.horizontal, 20)
        .padding(.vertical, 12)
    }

    // MARK: - Field group helper

    @ViewBuilder
    private func fieldGroup<Content: View>(
        label: String,
        @ViewBuilder content: () -> Content
    ) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(label)
                .font(.system(size: 11, weight: .medium))
                .foregroundStyle(theme.foreground.opacity(0.6))
                .textCase(.uppercase)
                .tracking(0.5)
            content()
        }
    }

    // MARK: - Submit

    private func submit() {
        loading = true
        error = nil
        Task { @MainActor in
            do {
                _ = try await env.projects?.forkProject(
                    projectId: project.id,
                    branch: branch.trimmingCharacters(in: .whitespacesAndNewlines),
                    folderName: folder.trimmingCharacters(in: .whitespacesAndNewlines)
                )
                loading = false
                isPresented.wrappedValue = false
            } catch let err {
                loading = false
                error = err.localizedDescription
            }
        }
    }
}
