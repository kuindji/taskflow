import Foundation
import CodeEditLanguages

/// Maps a file path to a `CodeLanguage` for syntax highlighting.
/// Delegates to `CodeLanguage.detectLanguageFrom(url:)` which handles all
/// extension-based and shebang/modeline detection; falls back to `.default`
/// (plain text) when no language can be identified.
///
/// Consumed by `EditorPane` and, in Task 6, by the Cmd+click import navigator.
enum LanguageDetection {
    static func language(forPath path: String) -> CodeLanguage {
        CodeLanguage.detectLanguageFrom(url: URL(fileURLWithPath: path))
    }
}
