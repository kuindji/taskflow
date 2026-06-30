import SwiftUI

/// Dialog shown when a project's filesystem path no longer exists.
/// Port of `packages/ui/src/components/sidebar/MissingLocationDialog.tsx`.
/// Lets the user relocate the project (NSOpenPanel) or permanently remove it.
struct MissingLocationDialog: View {
    let isPresented: Binding<Bool>
    let project: Project

    @Environment(AppEnvironment.self) private var env
    @Environment(\.appTheme) private var theme

    @State private var confirmRemove = false

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
        .alert("Remove Project?", isPresented: $confirmRemove) {
            Button("Remove", role: .destructive) {
                Task { @MainActor in
                    try? await env.projects?.removeProject(id: project.id)
                    isPresented.wrappedValue = false
                }
            }
            Button("Cancel", role: .cancel) {}
        }
    }

    // MARK: - Header

    private var header: some View {
        HStack {
            Text("Project Location Not Found")
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
        VStack(alignment: .leading, spacing: 8) {
            Text("The location for project \"\(project.name)\" could not be found:")
                .font(.system(size: 13))
                .foregroundStyle(theme.foreground)
                .fixedSize(horizontal: false, vertical: true)

            Text(project.path)
                .font(.system(.body, design: .monospaced))
                .foregroundStyle(theme.foreground.opacity(0.75))
                .lineLimit(3)
                .fixedSize(horizontal: false, vertical: true)

            Text("You can relocate the project to a new path, or remove it from Taskflow.")
                .font(.system(size: 12))
                .foregroundStyle(theme.foreground.opacity(0.55))
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    // MARK: - Footer

    private var footer: some View {
        HStack {
            AppButton(title: "Remove Project", kind: .destructive) {
                confirmRemove = true
            }
            Spacer()
            AppButton(title: "Change Location", kind: .secondary) {
                changeLocation()
            }
        }
        .padding(16)
    }

    // MARK: - Helpers

    @MainActor
    private func changeLocation() {
        let panel = NSOpenPanel()
        panel.canChooseDirectories = true
        panel.canChooseFiles = false
        panel.allowsMultipleSelection = false
        guard panel.runModal() == .OK, let url = panel.url else { return }
        Task { @MainActor in
            _ = try? await env.projects?.updateProject(id: project.id, path: url.path)
            isPresented.wrappedValue = false
        }
    }
}
