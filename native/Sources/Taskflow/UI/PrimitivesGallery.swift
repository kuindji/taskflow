import SwiftUI

struct PrimitivesGallery: View {
    @ObservedObject var themeStore: ThemeStore
    @State private var toggleOn = true
    @State private var text = "edit me"
    @State private var tab = 0

    var body: some View {
        let theme = themeStore.current
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                Picker("Theme", selection: Binding(
                    get: { theme.id },
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
            }
            .padding(24)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .background(theme.background)
        .environment(\.appTheme, theme)
    }
}
