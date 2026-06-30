import AppKit
import SwiftUI

/// Font-family picker backed by `NSFontManager.shared.availableFontFamilies`.
/// Port of `packages/ui/src/components/settings/FontFamilySelect.tsx`
/// (`window.queryLocalFonts()` → `NSFontManager.shared.availableFontFamilies`).
///
/// **Out-of-list handling:** the bound `value` may be a CSS font stack
/// (e.g. `"\"JetBrains Mono\", monospace"`) that won't match any family name.
/// `AppSelect`'s `Picker` only tags known options, so an absent value would
/// render with a blank menu label. To avoid silently garbling the stored value,
/// we fall back to `AppTextField` whenever families are loaded but `value` is
/// not among them. This keeps CSS stacks editable as plain text.
struct FontFamilySelect: View {
    @Binding var value: String
    @State private var families: [String] = []

    /// True when the text field should be shown instead of the picker.
    /// Covers two cases: families not yet loaded, or current value is not a
    /// plain family name (e.g. it is a CSS font stack).
    private var useTextField: Bool {
        families.isEmpty || !families.contains(value)
    }

    var body: some View {
        Group {
            if useTextField {
                AppTextField(text: $value, placeholder: "Font family")
            } else {
                AppSelect($value, options: families.map { (value: $0, label: $0) })
            }
        }
        .task { families = Self.families() }
    }

    /// Returns all installed font family names, deduplicated and sorted
    /// case-insensitively.
    nonisolated static func families() -> [String] {
        Array(Set(NSFontManager.shared.availableFontFamilies))
            .sorted { $0.localizedCaseInsensitiveCompare($1) == .orderedAscending }
    }
}
