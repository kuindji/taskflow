import Foundation

/// Session/tab type — mirrors the `Tab.type` union in `packages/ui/src/stores/session-helpers.ts`.
enum TabType: String, Codable, Sendable, CaseIterable {
    case claude, codex, opencode, gemini, cursor, pi, shell, editor, changes, browser, markdown
}

/// A workspace tab — 1:1 port of the `Tab` interface in `session-helpers.ts`.
struct Tab: Identifiable, Equatable, Codable, Sendable {
    let id: String
    var type: TabType
    var label: String
    var sessionId: String?
    var filePath: String?
    var url: String?
    var autoTitle: Bool?
    var trayExclude: Bool?
}

/// The active pane in a split workspace — mirrors `PaneId` in `ui-store.ts`.
enum PaneId: String, Codable, Sendable {
    case left, right
}

/// Per-workspace split state — mirrors `WorkspaceSplit` in `ui-store.ts`.
struct WorkspaceSplit: Equatable, Codable, Sendable {
    var open: Bool
    var ratio: Double
    var activePane: PaneId
}
