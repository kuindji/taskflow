import SwiftUI

struct DiffView: View {
    enum Kind: Equatable { case addition, deletion, context, hunkHeader, fileHeader }
    struct Line: Equatable, Identifiable {
        let id = UUID()
        let kind: Kind
        let text: String
    }

    let lines: [Line]
    @Environment(\.appTheme) private var theme

    init(unifiedDiff: String) { self.lines = Self.parse(unifiedDiff) }

    static func parse(_ unified: String) -> [Line] {
        guard !unified.isEmpty else { return [] }
        return unified.split(separator: "\n", omittingEmptySubsequences: false).map { raw in
            let s = String(raw)
            if s.hasPrefix("diff --git") || s.hasPrefix("index ") || s.hasPrefix("--- ") || s.hasPrefix("+++ ") {
                return Line(kind: .fileHeader, text: s)
            }
            if s.hasPrefix("@@") { return Line(kind: .hunkHeader, text: s) }
            if s.hasPrefix("+") { return Line(kind: .addition, text: String(s.dropFirst())) }
            if s.hasPrefix("-") { return Line(kind: .deletion, text: String(s.dropFirst())) }
            if s.hasPrefix(" ") { return Line(kind: .context, text: String(s.dropFirst())) }
            return Line(kind: .context, text: s)
        }
    }

    var body: some View {
        ScrollView([.vertical, .horizontal]) {
            VStack(alignment: .leading, spacing: 0) {
                ForEach(lines) { line in
                    Text(line.text.isEmpty ? " " : line.text)
                        .font(.system(.body, design: .monospaced))
                        .foregroundStyle(fg(line.kind))
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(bg(line.kind))
                }
            }.padding(.vertical, 4)
        }
    }

    private func fg(_ k: Kind) -> Color {
        switch k {
        case .hunkHeader, .fileHeader: return theme.color(.mutedForeground)
        default: return theme.foreground
        }
    }

    private func bg(_ k: Kind) -> Color {
        switch k {
        case .addition: return theme.success.opacity(0.12)
        case .deletion: return theme.destructive.opacity(0.12)
        default: return .clear
        }
    }
}
