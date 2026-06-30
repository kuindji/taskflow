import SwiftUI

/// Dialog that collects agent-launch options before starting a new agent session.
/// Port of `packages/ui/src/components/workspace/AgentOptionsDialog.tsx` +
/// `AgentOptionsPanel.tsx`.
/// Mounted in `GlobalDialogHost` bound to `env.runMenu?.runOptionsRequest`.
struct AgentOptionsDialog: View {
    @Binding var isPresented: Bool
    let request: RunOptionsRequest
    let onRun: (AgentLaunchOptions) -> Void
    let onCancel: () -> Void

    @Environment(AppEnvironment.self) private var env
    @Environment(\.appTheme) private var theme

    @State private var model: AgentOptionsFormModel

    init(
        isPresented: Binding<Bool>,
        request: RunOptionsRequest,
        onRun: @escaping (AgentLaunchOptions) -> Void,
        onCancel: @escaping () -> Void
    ) {
        _isPresented = isPresented
        self.request = request
        self.onRun = onRun
        self.onCancel = onCancel
        // Settings not available in init; re-seed on appear.
        _model = State(initialValue: AgentOptionsFormModel(seed: nil, settings: nil))
    }

    var body: some View {
        VStack(spacing: 0) {
            header

            ScrollView {
                AgentOptionsFormView(
                    model: model,
                    agent: request.agent,
                    onReset: { model.reset(to: env.settings?.settings) }
                )
                .padding(16)
            }
            .frame(maxHeight: .infinity)

            footer
        }
        .frame(width: 480)
        .background(theme.background)
        .onAppear {
            model = AgentOptionsFormModel(seed: nil, settings: env.settings?.settings)
        }
    }

    // MARK: - Header

    private var header: some View {
        HStack {
            Text(request.title)
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
            AppButton(title: "Run", kind: .primary) {
                if let opts = model.options(for: request.agent) {
                    onRun(opts)
                } else {
                    onCancel()
                }
            }
            .keyboardShortcut(.return, modifiers: .command)
        }
        .padding(16)
    }
}
