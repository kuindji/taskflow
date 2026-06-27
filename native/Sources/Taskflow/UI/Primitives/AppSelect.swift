import SwiftUI

/// Themed dropdown over a Hashable value (typed enums or strings), so option fragments
/// bind to `ClaudeEffortLevel?` etc. rather than stringly-typed values. The single select
/// control reused across every Phase-5 form.
struct AppSelect<Value: Hashable>: View {
    struct Option: Identifiable {
        let value: Value
        let label: String
        var id: Value { value }
    }

    @Environment(\.appTheme) private var theme
    private let selection: Binding<Value>
    private let options: [Option]

    init(_ selection: Binding<Value>, options: [(value: Value, label: String)]) {
        self.selection = selection
        self.options = options.map { Option(value: $0.value, label: $0.label) }
    }

    /// Pure: the label for the currently-selected value, or nil if not in `options`.
    /// Marked nonisolated so tests can call it without actor-hopping (Value need not be Sendable).
    nonisolated static func label(for value: Value, in options: [Option]) -> String? {
        options.first { $0.value == value }?.label
    }

    var body: some View {
        Picker("", selection: selection) {
            ForEach(options) { opt in
                Text(opt.label).tag(opt.value)
            }
        }
        .labelsHidden()
        .pickerStyle(.menu)
        .font(.system(size: 13))
        .tint(theme.color(.foreground))
        .frame(minWidth: 140, alignment: .trailing)
    }
}
