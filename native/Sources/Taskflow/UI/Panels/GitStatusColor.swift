import Foundation

/// Pure git-status presentation helpers. Ports the CVA `gitStatusVariants` table from
/// `packages/ui/src/components/panels/FileTree.tsx:12-36` and the `gitFiles` useMemo from
/// `FileExplorer.tsx:51-66`.
enum GitStatusColor {
    /// Valid raw statuses (FileTree.tsx `VALID_GIT_STATUSES`). Anything else falls back to "clean".
    private static let valid: Set<String> = ["new", "untracked", "modified", "deleted", "renamed"]

    /// Maps a raw git status (or nil) + an ignored flag to a theme token.
    /// Mirrors FileTree.tsx: a real status wins; else ignored dims; else clean.
    /// Note: the "ignored" tint is rendered at 50% opacity by the row view (TS `text-muted-foreground/50`).
    nonisolated static func token(forStatus status: String?, isIgnored: Bool) -> ThemeToken {
        if let status, valid.contains(status) {
            switch status {
            case "new", "untracked": return .success
            case "modified":         return .warning
            case "deleted":          return .destructive
            case "renamed":          return .accent
            default:                 return .secondaryForeground // unreachable: valid.contains(...) gates entry
            }
        }
        if isIgnored { return .mutedForeground }
        return .secondaryForeground
    }

    /// Builds an absolute-path → raw-status map from a `GitStatusResult`. Staged files are added
    /// first, then unstaged overwrite (matching FileExplorer.tsx). Absolute path is taken from
    /// `absolutePath` when present, else synthesized as `workingDir/relativePath`.
    nonisolated static func gitFilesMap(_ status: GitStatusResult?, workingDir: String) -> [String: String] {
        guard let status else { return [:] }
        var map: [String: String] = [:]
        for f in status.stagedFiles {
            map[f.absolutePath ?? "\(workingDir)/\(f.path)"] = f.status
        }
        for f in status.unstagedFiles {
            map[f.absolutePath ?? "\(workingDir)/\(f.path)"] = f.status
        }
        return map
    }
}
