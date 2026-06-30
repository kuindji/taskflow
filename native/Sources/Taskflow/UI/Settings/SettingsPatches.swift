// UI-local Encodable partials mirroring packages/shared SettingsUpdatePayload usage
// in packages/ui/src/stores/settings-store.ts. Synthesized Encodable omits nil
// (encodeIfPresent) so a patch carrying one field updates only that field.

struct GeneralPatch: Encodable {
    var fontFamily: String? = nil
    var fontSize: Double? = nil
    var defaultAgent: AgentType? = nil
    var defaultRuntime: String? = nil
    var favoriteAgents: [AgentType]? = nil
    var confirmBeforeExit: Bool? = nil
}

struct EditorPatch: Encodable {
    var fontFamily: String? = nil
    var fontSize: Double? = nil
    var wordWrap: Bool? = nil
    var internalEditor: String? = nil
    var externalEditor: String? = nil
}

struct TerminalPatch: Encodable {
    var fontFamily: String? = nil
    var fontSize: Double? = nil
    var defaultShell: String? = nil
}

struct ClaudePatch: Encodable {
    var defaultModel: String? = nil
    var defaultEffort: String? = nil       // written as the string form ("default"/"high"/…)
    var dangerouslySkipPermissions: Bool? = nil
    var permissionMode: String? = nil
}

struct CodexPatch: Encodable {
    var defaultModel: String? = nil
    var sandbox: CodexSandboxMode? = nil
    var approvalPolicy: CodexApprovalPolicy? = nil
    var fullAuto: Bool? = nil
}

struct OpenCodePatch: Encodable {
    var defaultModel: String? = nil
    var defaultVariant: String? = nil
    var autoApprove: Bool? = nil
}

struct GeminiPatch: Encodable {
    var defaultModel: String? = nil
    var approvalMode: String? = nil
    var sandbox: Bool? = nil
}

struct CursorPatch: Encodable {
    var defaultModel: String? = nil
    var yolo: Bool? = nil
}

struct PiPatch: Encodable {
    var defaultModel: String? = nil
    var thinking: PiThinkingLevel? = nil
    var tools: String? = nil
}

struct RemoteAgentPatch: Encodable {
    var autoStart: Bool? = nil
    var appName: String? = nil
    var headless: Bool? = nil
}

struct AppearancePatch: Encodable {
    var theme: String? = nil
}

struct SettingsPatch: Encodable {
    var general: GeneralPatch? = nil
    var editor: EditorPatch? = nil
    var terminal: TerminalPatch? = nil
    var claude: ClaudePatch? = nil
    var codex: CodexPatch? = nil
    var opencode: OpenCodePatch? = nil
    var gemini: GeminiPatch? = nil
    var cursor: CursorPatch? = nil
    var pi: PiPatch? = nil
    var remoteAgent: RemoteAgentPatch? = nil
    var appearance: AppearancePatch? = nil
}

// Fonts "Reset to defaults" sends explicit nulls; the backend re-expands nulls to
// DEFAULTS (packages/backend/src/services/settings-store.ts applyNullable).
// Scoped custom encoder — do NOT override encode(to:) on a generated type.
struct FontResetPatch: Encodable {
    private struct FontNulls: Encodable {
        func encode(to encoder: Encoder) throws {
            var c = encoder.container(keyedBy: K.self)
            try c.encodeNil(forKey: .fontFamily)
            try c.encodeNil(forKey: .fontSize)
        }
        enum K: String, CodingKey { case fontFamily, fontSize }
    }

    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: K.self)
        try c.encode(FontNulls(), forKey: .general)
        try c.encode(FontNulls(), forKey: .terminal)
        try c.encode(FontNulls(), forKey: .editor)
    }

    enum K: String, CodingKey { case general, terminal, editor }
}
