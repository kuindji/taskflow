import AppKit
import SwiftUI
import CodeEditSourceEditor

/// Factory that maps the app's `AppTheme` token set to a `CodeEditSourceEditor.EditorTheme`.
///
/// Extends `CodeEditSourceEditor.EditorTheme` so the call-site is simply `EditorTheme.from(theme)`,
/// avoiding the need to declare a new type that would shadow the imported struct. Consumed by
/// `EditorPane` and reused by Task 6.
extension EditorTheme {
    static func from(_ theme: AppTheme) -> EditorTheme {
        func ns(_ token: ThemeToken) -> NSColor { NSColor(theme.color(token)) }
        return .init(
            text:           .init(color: ns(.foreground)),
            insertionPoint: ns(.primary),
            invisibles:     .init(color: ns(.mutedForeground)),
            background:     ns(.background),
            lineHighlight:  ns(.muted),
            selection:      ns(.accent),
            keywords:       .init(color: ns(.primary)),
            commands:       .init(color: ns(.info)),
            types:          .init(color: ns(.info)),
            attributes:     .init(color: ns(.accentForeground)),
            variables:      .init(color: ns(.foreground)),
            values:         .init(color: ns(.success)),
            numbers:        .init(color: ns(.warning)),
            strings:        .init(color: ns(.success)),
            characters:     .init(color: ns(.success)),
            comments:       .init(color: ns(.mutedForeground))
        )
    }
}
