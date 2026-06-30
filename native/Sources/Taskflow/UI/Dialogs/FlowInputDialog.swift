import SwiftUI

/// Collects user-supplied input values before starting a flow that declares inputs.
/// Port of `packages/ui/src/components/flows/FlowInputDialog.tsx`.
/// Mounted in `GlobalDialogHost` bound to `env.runMenu?.flowInputRequest`.
struct FlowInputDialog: View {
    @Binding var isPresented: Bool
    let request: FlowInputRequest
    let onSubmit: ([String: String]) -> Void
    let onCancel: () -> Void

    @Environment(\.appTheme) private var theme

    @State private var values: [String: String] = [:]

    private var allFilled: Bool {
        request.inputs.allSatisfy {
            !(values[$0.id] ?? "").trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        }
    }

    var body: some View {
        VStack(spacing: 0) {
            header

            ScrollView {
                VStack(spacing: 16) {
                    ForEach(request.inputs, id: \.id) { (input: FlowInputDefinition) in
                        VStack(alignment: .leading, spacing: 6) {
                            Text(input.label)
                                .font(.system(size: 13, weight: .medium))
                                .foregroundStyle(theme.foreground)

                            HStack(spacing: 8) {
                                AppTextField(
                                    text: binding(for: input.id),
                                    placeholder: input.type == "filepath" ? "Select a file…" : ""
                                )

                                if input.type == "filepath" {
                                    AppButton(title: "Browse…", kind: .secondary) {
                                        pickFile(for: input.id)
                                    }
                                }
                            }
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                    }
                }
                .padding(16)
            }
            .frame(maxHeight: .infinity)

            footer
        }
        .frame(width: 440)
        .background(theme.background)
    }

    // MARK: - Header

    private var header: some View {
        HStack {
            Text("Flow Input: \(request.flowName)")
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(theme.foreground)
            Spacer()
            Button {
                onCancel()
            } label: {
                AppIcon("X").font(.system(size: 13))
            }
            .buttonStyle(.plain)
            .foregroundStyle(theme.foreground.opacity(0.6))
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
    }

    // MARK: - Footer

    private var footer: some View {
        HStack {
            Spacer()
            AppButton(title: "Cancel", kind: .secondary, action: onCancel)
            AppButton(title: "Start Flow", kind: .primary) {
                onSubmit(values)
            }
            .keyboardShortcut(.return, modifiers: .command)
            .disabled(!allFilled)
            .opacity(allFilled ? 1.0 : 0.5)
        }
        .padding(16)
    }

    // MARK: - Helpers

    private func binding(for id: String) -> Binding<String> {
        Binding(
            get: { values[id] ?? "" },
            set: { values[id] = $0 }
        )
    }

    @MainActor
    private func pickFile(for id: String) {
        let panel = NSOpenPanel()
        panel.canChooseFiles = true
        panel.canChooseDirectories = false
        panel.allowsMultipleSelection = false
        if panel.runModal() == .OK, let url = panel.url {
            values[id] = url.path
        }
    }
}
