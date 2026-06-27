/// Workspace key factory — mirrors `getTaskWorkspaceKey` / `getProjectWorkspaceKey` /
/// `MASTER_WORKSPACE_KEY` from `packages/ui/src/hooks/useActiveWorkspace.ts` and the
/// `:right` pane suffix pattern used throughout `session-helpers.ts` and `ui-store.ts`.
enum WorkspaceKey {
    /// Key for a task workspace: `"task:<id>"`.
    static func task(_ id: String) -> String { "task:\(id)" }

    /// Key for a project workspace: `"project:<id>"`.
    static func project(_ id: String) -> String { "project:\(id)" }

    /// Key for the master (home) workspace.
    static let master: String = "master"

    /// Returns the right-pane key for `key`: `"<key>:right"`.
    static func right(_ key: String) -> String { "\(key):right" }

    /// Whether `key` refers to a right pane (has `:right` suffix).
    static func isRight(_ key: String) -> Bool { key.hasSuffix(":right") }

    /// Strips the `:right` suffix from `key`; returns `key` unchanged if absent.
    static func base(_ key: String) -> String {
        guard key.hasSuffix(":right") else { return key }
        return String(key.dropLast(":right".count))
    }
}
