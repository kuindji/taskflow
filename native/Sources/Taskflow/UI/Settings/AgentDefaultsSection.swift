import SwiftUI

// Port of packages/ui/src/components/shared/*Options.tsx defaults-mode usage,
// wiring each per-agent fragment to env.settings with group patches.
struct AgentDefaultsSection: View {
    @Environment(AppEnvironment.self) private var env
    let agent: AgentType

    var body: some View {
        if let vm = env.settings, let s = vm.settings {
            switch agent {
            case .claude:
                ClaudeOptionsView(
                    model: Binding(
                        get: { s.claude.defaultModel == "default" ? nil : s.claude.defaultModel },
                        set: { persist(ClaudePatch(defaultModel: $0 ?? "default")) }
                    ),
                    effort: Binding(
                        get: { decodeEffort(s.claude.defaultEffort) },
                        set: { persist(ClaudePatch(defaultEffort: $0?.rawValue ?? "default")) }
                    ),
                    skipPermissions: Binding(
                        get: { s.claude.dangerouslySkipPermissions },
                        set: { persist(ClaudePatch(dangerouslySkipPermissions: $0)) }
                    ),
                    permissionMode: Binding(
                        get: { decodePermissionMode(s.claude.permissionMode) },
                        set: { persist(ClaudePatch(permissionMode: $0.rawValue)) }
                    ),
                    mode: .defaults
                )
            case .codex:
                CodexOptionsView(
                    model: bind(s.codex.defaultModel) { persist(CodexPatch(defaultModel: $0)) },
                    fullAuto: bind(s.codex.fullAuto) { persist(CodexPatch(fullAuto: $0)) },
                    sandbox: bind(s.codex.sandbox) { persist(CodexPatch(sandbox: $0)) },
                    approvalPolicy: bind(s.codex.approvalPolicy) { persist(CodexPatch(approvalPolicy: $0)) },
                    mode: .defaults
                )
            case .opencode:
                // OpenCodeOptionsView renders variant via AppSelect(options: [("", "None"), ...])
                // so it handles the ""⇄"None" display internally; we pass/persist the raw "".
                OpenCodeOptionsView(
                    model: bind(s.opencode.defaultModel) { persist(OpenCodePatch(defaultModel: $0)) },
                    variant: bind(s.opencode.defaultVariant) { persist(OpenCodePatch(defaultVariant: $0)) },
                    autoApprove: bind(s.opencode.autoApprove) { persist(OpenCodePatch(autoApprove: $0)) },
                    mode: .defaults
                )
            case .gemini:
                GeminiOptionsView(
                    model: bind(s.gemini.defaultModel) { persist(GeminiPatch(defaultModel: $0)) },
                    approvalMode: bind(s.gemini.approvalMode) { persist(GeminiPatch(approvalMode: $0)) },
                    sandbox: bind(s.gemini.sandbox) { persist(GeminiPatch(sandbox: $0)) },
                    mode: .defaults
                )
            case .cursor:
                CursorOptionsView(
                    model: bind(s.cursor.defaultModel) {
                        // TS: defaultModel || "default" — coerce empty to sentinel
                        persist(CursorPatch(defaultModel: $0.isEmpty ? "default" : $0))
                    },
                    yolo: bind(s.cursor.yolo) { persist(CursorPatch(yolo: $0)) },
                    mode: .defaults
                )
            case .pi:
                PiOptionsView(
                    model: bind(s.pi.defaultModel) { persist(PiPatch(defaultModel: $0)) },
                    thinking: bind(s.pi.thinking) { persist(PiPatch(thinking: $0)) },
                    tools: bind(s.pi.tools) { persist(PiPatch(tools: $0)) },
                    mode: .defaults
                )
            }
        }
    }

    // MARK: - Persist overloads (one per group)

    private func persist(_ patch: ClaudePatch) {
        Task { await env.settings?.updateSettings(SettingsPatch(claude: patch)) }
    }

    private func persist(_ patch: CodexPatch) {
        Task { await env.settings?.updateSettings(SettingsPatch(codex: patch)) }
    }

    private func persist(_ patch: OpenCodePatch) {
        Task { await env.settings?.updateSettings(SettingsPatch(opencode: patch)) }
    }

    private func persist(_ patch: GeminiPatch) {
        Task { await env.settings?.updateSettings(SettingsPatch(gemini: patch)) }
    }

    private func persist(_ patch: CursorPatch) {
        Task { await env.settings?.updateSettings(SettingsPatch(cursor: patch)) }
    }

    private func persist(_ patch: PiPatch) {
        Task { await env.settings?.updateSettings(SettingsPatch(pi: patch)) }
    }

    // MARK: - Binding helper for direct (non-AnyCodable) fields

    private func bind<V>(_ value: V, set: @escaping @Sendable (V) -> Void) -> Binding<V> {
        Binding(get: { value }, set: set)
    }

    // MARK: - Claude AnyCodable decode (precedent: AgentOptionsFormModel.swift:164)

    private func decodeEffort(_ c: AnyCodable) -> ClaudeEffortLevel? {
        if case .string(let raw) = c.value { return ClaudeEffortLevel(rawValue: raw) }
        return nil  // "default" or invalid → nil (renders as "Default")
    }

    private func decodePermissionMode(_ c: AnyCodable) -> ClaudePermissionMode {
        if case .string(let raw) = c.value, let m = ClaudePermissionMode(rawValue: raw) { return m }
        return .default
    }
}
