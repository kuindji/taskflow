import SwiftUI
import CodeEditSourceEditor
import CodeEditLanguages

struct EditorPane: View {
    let filePath: String

    @State private var text: String
    @State private var cursors: [CursorPosition] = [CursorPosition(line: 1, column: 1)]

    init(filePath: String) {
        self.filePath = filePath
        // Load synchronously so makeNSViewController receives the real content.
        // CodeEditSourceEditor reads the binding value at construction time only;
        // updates via onAppear arrive too late and are not pushed into the view.
        let content = (try? String(contentsOfFile: filePath, encoding: .utf8))
            ?? "// could not read \(filePath)"
        self._text = State(initialValue: content)
    }

    var body: some View {
        CodeEditSourceEditor(
            $text,
            language: .swift,
            theme: .xcodeDefault,
            font: .monospacedSystemFont(ofSize: 13, weight: .regular),
            tabWidth: 4,
            lineHeight: 1.2,
            wrapLines: true,
            cursorPositions: $cursors,
            showMinimap: false
        )
    }
}

private extension EditorTheme {
    /// A minimal Xcode-inspired default theme for the spike.
    static var xcodeDefault: EditorTheme {
        EditorTheme(
            text:            .init(color: .labelColor),
            insertionPoint:  .labelColor,
            invisibles:      .init(color: .tertiaryLabelColor),
            background:      .textBackgroundColor,
            lineHighlight:   .selectedTextBackgroundColor,
            selection:       .selectedTextBackgroundColor,
            keywords:        .init(color: NSColor(red: 0.67, green: 0.05, blue: 0.57, alpha: 1)),
            commands:        .init(color: NSColor(red: 0.53, green: 0.11, blue: 0.53, alpha: 1)),
            types:           .init(color: NSColor(red: 0.15, green: 0.47, blue: 0.58, alpha: 1)),
            attributes:      .init(color: NSColor(red: 0.53, green: 0.11, blue: 0.53, alpha: 1)),
            variables:       .init(color: .labelColor),
            values:          .init(color: NSColor(red: 0.20, green: 0.43, blue: 0.18, alpha: 1)),
            numbers:         .init(color: NSColor(red: 0.11, green: 0.00, blue: 0.81, alpha: 1)),
            strings:         .init(color: NSColor(red: 0.77, green: 0.10, blue: 0.09, alpha: 1)),
            characters:      .init(color: NSColor(red: 0.77, green: 0.10, blue: 0.09, alpha: 1)),
            comments:        .init(color: NSColor(red: 0.39, green: 0.44, blue: 0.49, alpha: 1))
        )
    }
}
