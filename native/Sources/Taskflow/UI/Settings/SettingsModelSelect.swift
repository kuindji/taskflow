import SwiftUI

// Fetched model dropdowns. Port of packages/ui/src/components/settings/{Cursor,OpenCode,Pi}ModelSelect.tsx.
// Lazy-fetch on appear via env.models; AppSelect when models load, AppTextField fallback.
//
// Parity gap: the TS OpenCode/Pi selects allow entering a custom value via Enter in the
// search box while the populated list is visible. AppSelect is a fixed menu, so custom
// values are only writable through the AppTextField fallback (shown whenever models have
// not loaded or the fetch failed). Accepted limitation for 5E.

struct CursorModelSelect: View {
    @Binding var value: String
    @Environment(AppEnvironment.self) private var env

    var body: some View {
        Group {
            if let models = env.models, models.cursorLoaded, !models.cursorFailed {
                AppSelect(
                    Binding(
                        get: { value.isEmpty ? "default" : value },
                        set: { value = ($0 == "default") ? "default" : $0 }
                    ),
                    options: [(value: "default", label: "Default")]
                        + models.cursor.map { (value: $0.id, label: $0.label) }
                )
            } else {
                AppTextField(text: $value, placeholder: "default")
            }
        }
        .task { await env.models?.ensureCursor() }
    }
}

struct OpenCodeModelSelect: View {
    @Binding var value: String
    @Environment(AppEnvironment.self) private var env

    var body: some View {
        Group {
            if let models = env.models, models.opencodeLoaded, !models.opencodeFailed {
                AppSelect(
                    $value,
                    options: models.opencode.map { (value: $0.id, label: $0.id) }
                )
            } else {
                AppTextField(text: $value, placeholder: "e.g. anthropic/claude-sonnet-4-20250514")
            }
        }
        .task { await env.models?.ensureOpenCode() }
    }
}

struct PiModelSelect: View {
    @Binding var value: String
    @Environment(AppEnvironment.self) private var env

    var body: some View {
        Group {
            if let models = env.models, models.piLoaded, !models.piFailed {
                AppSelect(
                    $value,
                    options: models.pi.map {
                        let key = "\($0.provider)/\($0.id)"
                        return (value: key, label: key)
                    }
                )
            } else {
                AppTextField(text: $value, placeholder: "e.g. anthropic/claude-sonnet-4.5")
            }
        }
        .task { await env.models?.ensurePi() }
    }
}
