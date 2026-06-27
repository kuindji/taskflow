import SwiftUI

struct PrimitivesGallery: View {
    var themeStore: ThemeStore
    @State private var toggleOn = true
    @State private var text = "edit me"
    @State private var tab = 0
    @State private var galleryAgent: AgentType = .claude

    var body: some View {
        let theme = themeStore.current
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                Picker("Theme", selection: Binding(
                    get: { themeStore.current.id },
                    set: { themeStore.select(id: $0) })) {
                    ForEach(themeStore.all) { t in Text(t.name).tag(t.id) }
                }
                .frame(width: 260)

                HStack(spacing: 8) {
                    AppButton(title: "Primary", kind: .primary) {}
                    AppButton(title: "Secondary", kind: .secondary) {}
                    AppButton(title: "Delete", kind: .destructive) {}
                }
                AppToggle(title: "Enabled", isOn: $toggleOn)
                AppTextField(text: $text)
                AppSegmentedTabs(selection: $tab, titles: ["One", "Two", "Three"])
                HStack { AppBadge(text: "active"); AppBadge(text: "3") }
                AppMenu(title: "Options") {
                    Button("Action One") {}
                    Button("Action Two") {}
                }

                // MARK: Phase 5A foundations
                Text("Agent option fragments").font(.headline)
                HStack(spacing: 8) {
                    ForEach([AgentType.claude, .codex, .opencode, .gemini, .cursor, .pi], id: \.rawValue) { a in
                        AgentIcon(a, size: 20)
                    }
                }
                HStack(spacing: 12) {
                    AppIcon("Plus"); AppIcon("Trash2"); AppIcon("GitBranch"); AppIcon("Bell"); AppIcon("Workflow")
                }
                AppSelect($galleryAgent, options: [
                    (.claude, "Claude"), (.codex, "Codex"), (.opencode, "OpenCode"),
                    (.gemini, "Gemini"), (.cursor, "Cursor"), (.pi, "Pi"),
                ])
                AgentOptionsView(agent: galleryAgent)
            }
            .padding(24)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .background(theme.background)
    }
}
