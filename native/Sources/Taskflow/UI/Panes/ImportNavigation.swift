import Foundation

/// Pure port of `extractImportSpecifier` from
/// `packages/ui/src/lib/monaco-import-navigation.ts`.
///
/// Handles three import patterns (same as the TS reference):
///   - `import ... from "specifier"` / `import ... from 'specifier'`
///   - `import "specifier"` / `import 'specifier'` (side-effect imports)
///   - `require("specifier")` / `require('specifier')`
///
/// Column convention: **1-based**, matching `CursorPosition.column` from
/// CodeEditSourceEditor. Pass `cursors.first?.column` directly.
enum ImportNavigation {

    // MARK: - specifier extraction (pure)

    /// Returns the import module specifier under `column` on `line`, or nil.
    ///
    /// Only considers lines that contain an `import`, `export`, `require`, or `from`
    /// keyword (mirrors the TS regex gate). Scans quoted tokens and returns the
    /// content of the one whose character range covers the cursor column.
    ///
    /// - Parameters:
    ///   - line:   Full text of the line (no trailing newline required).
    ///   - column: 1-based column index of the cursor (matches `CursorPosition.column`).
    /// - Returns: The specifier string (without quotes), or nil if the cursor is not
    ///            inside a quoted string on an import/require line.
    static func specifier(inLine line: String, column: Int) -> String? {
        // Gate: must be an import-ish line (import / export / require / from)
        guard line.range(
            of: #"\b(import|export|require|from)\b"#,
            options: .regularExpression
        ) != nil else { return nil }

        let chars = Array(line)
        // Convert 1-based column to 0-based character index
        let col = column - 1
        guard col >= 0, col < chars.count else { return nil }

        // Walk the line, find each quoted token, check if col falls inside it
        var i = 0
        while i < chars.count {
            let c = chars[i]
            if c == "\"" || c == "'" {
                let quote = c
                let start = i + 1   // 0-based index of first character inside the quotes
                var j = start
                while j < chars.count && chars[j] != quote { j += 1 }
                // chars[start..<j] is the specifier text; chars[j] is the closing quote
                if col >= start && col < j {
                    return String(chars[start..<j])
                }
                i = j + 1
                continue
            }
            i += 1
        }
        return nil
    }

    // MARK: - backend resolution

    /// Resolves `specifier` to an absolute file path via the backend `ts:resolve-import` RPC.
    ///
    /// Uses the generated `TsResolveImportResponse` type (field `resolvedPath: String?`).
    /// Payload keys match the backend handler: `sourceFilePath` and `importSpecifier`.
    ///
    /// Returns the resolved path, or nil if the backend cannot resolve it or if the
    /// request fails (network error, timeout, sidecar not running, etc.).
    ///
    /// Marked `@MainActor` because `WSClient` is main-actor-isolated; callers from
    /// `Task { @MainActor in }` blocks (e.g., EditorPane gesture handler) need no
    /// actor hop.
    @MainActor
    static func resolve(specifier: String, fromFile: String, client: WSClient) async -> String? {
        let resp: TsResolveImportResponse? = try? await client.request(
            .tsResolveImport,
            payload: ["sourceFilePath": fromFile, "importSpecifier": specifier]
        )
        return resp?.resolvedPath
    }
}
