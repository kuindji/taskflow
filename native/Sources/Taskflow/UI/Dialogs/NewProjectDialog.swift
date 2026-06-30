import SwiftUI

/// Presentation-only form for adding a new project.
/// Port of `packages/ui/src/components/sidebar/NewProjectDialog.tsx`.
/// The host (Task 7) owns the open flag and provides `onSubmit`.
struct NewProjectDialog: View {
    @Binding var isPresented: Bool
    let error: String?
    let onSubmit: (String) -> Void

    @Environment(\.appTheme) private var theme

    @State private var path: String = ""

    private var canSubmit: Bool {
        !path.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    var body: some View {
        VStack(spacing: 0) {
            header

            ScrollView {
                VStack(spacing: 12) {
                    // Directory input with browse button
                    HStack(spacing: 8) {
                        AppTextField(text: $path, placeholder: "/path/to/project")
                        AppButton(title: "Browse…", kind: .secondary) {
                            if let selectedURL = pickDirectory() {
                                path = selectedURL.path
                            }
                        }
                    }

                    // Error message
                    if let error = error, !error.isEmpty {
                        Text(error)
                            .font(.system(size: 12))
                            .foregroundStyle(theme.destructive)
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }
                }
                .padding(16)
            }
            .frame(maxHeight: .infinity)

            // Submit button
            HStack {
                Spacer()
                AppButton(
                    title: "Add Project",
                    kind: .primary,
                    action: submitForm
                )
                .keyboardShortcut(.return, modifiers: .command)
                .disabled(!canSubmit)
                .opacity(canSubmit ? 1.0 : 0.5)
            }
            .padding(16)
        }
        .frame(width: 420)
        .background(theme.background)
    }

    // MARK: - Header

    private var header: some View {
        HStack {
            Text("Add Project")
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(theme.foreground)
            Spacer()
            Button {
                isPresented = false
            } label: {
                AppIcon("X").font(.system(size: 13))
            }
            .buttonStyle(.plain)
            .foregroundStyle(theme.foreground.opacity(0.6))
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
    }

    // MARK: - Helpers

    @MainActor
    private func pickDirectory() -> URL? {
        let panel = NSOpenPanel()
        panel.canChooseDirectories = true
        panel.canChooseFiles = false
        panel.allowsMultipleSelection = false
        return panel.runModal() == .OK ? panel.url : nil
    }

    private func submitForm() {
        let trimmedPath = path.trimmingCharacters(in: .whitespacesAndNewlines)
        if !trimmedPath.isEmpty {
            onSubmit(trimmedPath)
        }
    }
}
