import SwiftUI

/// Search results — expandable per-file groups with highlighted match lines. Port of
/// `packages/ui/src/components/panels/SearchResults.tsx`.
struct SearchResultsView: View {
    @Environment(\.appTheme) private var theme
    @Environment(AppEnvironment.self) private var env
    let rootPath: String

    private var search: SearchViewModel? { env.search }

    var body: some View {
        if let search {
            VStack(alignment: .leading, spacing: 0) {
                Text("\(search.totalMatches) result(s) in \(search.results.count) file(s)")
                    .font(.system(size: 11)).foregroundStyle(theme.color(.mutedForeground))
                    .padding(.horizontal, 8).padding(.vertical, 4)
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 0) {
                        ForEach(search.results, id: \.path) { file in
                            fileGroup(file)
                        }
                    }
                }
            }
        }
    }

    @ViewBuilder private func fileGroup(_ file: SearchFileResult) -> some View {
        let expanded = search?.expandedFiles.contains(file.path) ?? false
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 4) {
                AppIcon(expanded ? "ChevronDown" : "ChevronRight").font(.system(size: 9))
                Text(fileName(file.path)).font(.system(size: 12)).lineLimit(1)
                Text("\(file.matches.count)").font(.system(size: 9))
                    .padding(.horizontal, 4)
                    .background(theme.color(.muted)).clipShape(RoundedRectangle(cornerRadius: 3))
                Spacer(minLength: 4)
            }
            .padding(.horizontal, 8).padding(.vertical, 3)
            .contentShape(Rectangle())
            .onTapGesture { search?.toggleFileExpanded(path: file.path) }
            .contextMenu {
                Button("Replace All in File") {
                    Task { await search?.replaceInFile(rootPath: rootPath, filePath: file.path) }
                }
                Button("Dismiss File") { search?.removeFile(filePath: file.path) }
            }
            if expanded {
                // SearchMatch is Equatable but not Hashable, so use index-based ForEach.
                ForEach(Array(file.matches.enumerated()), id: \.offset) { _, match in
                    matchLine(file: file, match: match)
                }
            }
        }
    }

    @ViewBuilder private func matchLine(file: SearchFileResult, match: SearchMatch) -> some View {
        let parts = Self.splitLine(match.lineContent, column: Int(match.column),
                                   matchLength: Int(match.matchLength))
        HStack(alignment: .top, spacing: 6) {
            Text("\(Int(match.line))").font(.system(size: 10, design: .monospaced))
                .foregroundStyle(theme.color(.mutedForeground)).frame(width: 32, alignment: .trailing)
            (Text(parts.before)
                + Text(parts.match).foregroundStyle(theme.color(.accentForeground))
                    .bold()
                + Text(parts.after))
                .font(.system(size: 11, design: .monospaced))
                .lineLimit(1)
            Spacer(minLength: 4)
        }
        .padding(.leading, 16).padding(.trailing, 8).padding(.vertical, 1)
        .contextMenu {
            Button("Replace") {
                Task { await search?.replaceMatch(rootPath: rootPath, filePath: file.path, match: match) }
            }
            Button("Dismiss") { search?.removeMatch(filePath: file.path, match: match) }
        }
    }

    private func fileName(_ path: String) -> String {
        path.contains("/") ? String(path[path.index(after: path.lastIndex(of: "/")!)...]) : path
    }

    /// Splits a line into (before, match, after) around a 1-based column + match length.
    /// Mirrors the `HighlightedLine` slice math in SearchResults.tsx. Clamps to bounds so an
    /// out-of-range column never crashes and is lossless.
    nonisolated static func splitLine(_ line: String, column: Int, matchLength: Int)
        -> (before: String, match: String, after: String) {
        let chars = Array(line)
        let start = max(0, min(column - 1, chars.count))
        let end = max(start, min(start + matchLength, chars.count))
        return (String(chars[0..<start]), String(chars[start..<end]), String(chars[end...]))
    }
}
