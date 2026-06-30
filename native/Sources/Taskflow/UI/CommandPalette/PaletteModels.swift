import Foundation

/// A runnable palette entry. Ports the `PaletteEntry` union in `CommandPaletteDialog.tsx`.
enum PaletteEntry: Equatable {
    case action(ActionDefinition)
    case script(String)
}

/// One rendered palette row. `indices` are matched-char positions for bold highlighting.
struct PaletteRow: Identifiable, Equatable {
    let id: String
    let entry: PaletteEntry
    let label: String
    let detail: String
    let disabled: Bool
    let indices: [Int]
}

/// A titled group of rows ("Actions" | "package.json").
struct PaletteGroup: Identifiable, Equatable {
    let id: String
    let title: String
    let rows: [PaletteRow]
}

/// Builds the palette's two groups with fuzzy filter + score sort.
/// Ports the `groups` memo in `packages/ui/src/components/CommandPaletteDialog.tsx`.
enum PaletteBuilder {
    nonisolated static func buildGroups(
        actions: [ActionDefinition],
        scripts: [String: String],
        online: Bool,
        defaultRuntime: String,
        query: String
    ) -> [PaletteGroup] {
        let actionRows: [PaletteRow] = actions.map { a in
            PaletteRow(
                id: "action:\(a.id)", entry: .action(a), label: a.name,
                detail: online ? a.sessionType.rawValue : "offline",
                disabled: !online, indices: [])
        }
        let scriptRows: [PaletteRow] = scripts.keys.sorted().map { name in
            PaletteRow(
                id: "script:\(name)", entry: .script(name), label: name,
                detail: defaultRuntime, disabled: false, indices: [])
        }

        func filtered(_ rows: [PaletteRow]) -> [PaletteRow] {
            guard !query.isEmpty else { return rows }
            let scored: [(row: PaletteRow, score: Int)] = rows.compactMap { row in
                guard let r = FuzzyMatch.match(query, row.label) else { return nil }
                let hl = PaletteRow(id: row.id, entry: row.entry, label: row.label,
                                    detail: row.detail, disabled: row.disabled, indices: r.indices)
                return (hl, r.score)
            }
            return scored
                .enumerated()
                .sorted { a, b in a.element.score != b.element.score ? a.element.score > b.element.score : a.offset < b.offset }
                .map { $0.element.row }
        }

        var groups: [PaletteGroup] = []
        let a = filtered(actionRows)
        if !a.isEmpty { groups.append(PaletteGroup(id: "actions", title: "Actions", rows: a)) }
        let s = filtered(scriptRows)
        if !s.isEmpty { groups.append(PaletteGroup(id: "scripts", title: "package.json", rows: s)) }
        return groups
    }
}
