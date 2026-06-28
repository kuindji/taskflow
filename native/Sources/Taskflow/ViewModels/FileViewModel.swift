import Foundation
import Observation

/// UI-local type mirroring `PendingMove` from `packages/ui/src/stores/file-store.ts`.
/// Classification: UI-LOCAL — defined only in `packages/ui`, not in `@taskflow/shared`,
/// so hand-authored here as a pragmatic unblock (not a codegen gap).
struct PendingMove: Codable, Sendable, Equatable {
    let sourcePath: String
    let destinationDir: String
}

/// 1:1 port of `packages/ui/src/stores/file-store.ts`.
///
/// Behavioral notes:
/// - **Request dedupe:** `treeRequestId` and `gitStatusRequestId` are monotonically-increasing
///   `Int`s. Each `fetchTree`/`fetchGitStatus` call increments the relevant counter before the
///   RPC, captures the id, and drops its response if the stored id has advanced in the meantime.
///   Matches the TS module-level `let treeRequestId = 0` / `let gitStatusRequestId = 0` counters.
/// - **`toggleDir`/`expandDir`** fire-and-forget `fetchDir` when the tree exists and the
///   directory is not yet loaded, matching TS `void get().fetchDir(path)` / the awaited call
///   in `expandDir`. Both are synchronous in Swift (set update is immediate); the fetch is
///   a `Task { }` side-effect.
/// - **`watchPath`** registers the `file:changed` WS handler lazily (on first call), matching
///   the TS `fileChangeSubscriptionReady` guard. On each event, collects the parent dir into
///   `pendingChangedPaths`, debounces 150ms, then refetches each loaded dir + git status.
/// - **`bind()`** is intentionally empty — the only subscription (`file:changed`) is
///   registered lazily inside `watchPath` to match the TS lazy-guard pattern.
/// - **`onOpenFile`** is an injected closure for opening a file in the editor; wired Phase 4.
/// - **diff-store subscription** inside `watchPath` is a **Phase-5 seam** (diff-store not ported).
@MainActor
@Observable
final class FileViewModel {
    private(set) var tree: FileNode? = nil
    private(set) var treePath: String? = nil
    private(set) var gitignorePatterns: [String] = []
    private(set) var gitStatus: GitStatusResult? = nil
    private(set) var gitStatusPath: String? = nil
    private(set) var watchedPath: String? = nil
    private(set) var loading: Bool = false
    private(set) var loadingDirs: Set<String> = []
    private(set) var expandedDirs: Set<String> = []
    var focusedPath: String? = nil
    var contextMenuPath: String? = nil
    var dragOverPath: String? = nil
    private(set) var pendingMove: PendingMove? = nil

    /// Injected: opens a file in the editor. Wired in Phase 4. Never a direct UI reference.
    var onOpenFile: ((String) -> Void)? = nil

    @ObservationIgnored private let client: WSClient
    /// Monotonically increasing; incremented on each `fetchTree` call.
    /// Responses whose captured id no longer matches the current value are dropped.
    @ObservationIgnored private var treeRequestId: Int = 0
    /// Monotonically increasing; incremented on each `fetchGitStatus` call.
    @ObservationIgnored private var gitStatusRequestId: Int = 0
    /// Guards the lazy one-time registration of the `file:changed` WS handler.
    @ObservationIgnored private var fileChangeSubscriptionReady: Bool = false
    /// Accumulates changed paths between debounce ticks. Mirrors `pendingChangedDirs` in file-store.ts.
    @ObservationIgnored private var pendingChangedPaths: Set<String> = []
    /// Running debounce task; cancelled and replaced on each new file-change event.
    @ObservationIgnored private var changeDebounce: Task<Void, Never>?

    init(client: WSClient) {
        self.client = client
    }

    // MARK: - Bind (WS event subscriptions)

    /// Called once by `AppEnvironment.bind()`.
    /// The `file:changed` handler is registered lazily in `watchPath` (matching file-store.ts).
    func bind() {
        // file:changed subscription is wired lazily in watchPath().
    }

    // MARK: - fetchTree

    /// Fetches the root directory listing and rebuilds the tree.
    /// Mirrors `fetchTree(path)` in `file-store.ts:114-142`.
    func fetchTree(path: String) async {
        treeRequestId += 1
        let requestId = treeRequestId
        // Clear tree only when switching to a different root path
        if treePath != path {
            tree = nil
            treePath = nil
            gitignorePatterns = []
        }
        loadingDirs = []
        loading = true
        do {
            let resp: FileListDirResponse = try await client.request(
                .fileListDir,
                payload: ["path": path]
            )
            if requestId != treeRequestId { return }  // stale — a newer request supersedes
            let lastName = path.split(separator: "/").last.map(String.init) ?? path
            let rootNode = FileNode(
                name: lastName,
                path: path,
                type: "directory",
                children: resp.entries,
                loaded: true,
                gitStatus: nil
            )
            tree = rootNode
            treePath = path
            gitignorePatterns = resp.gitignorePatterns
            loading = false
            expandedDirs = [path]
        } catch {
            if requestId == treeRequestId {
                loading = false
            }
        }
    }

    // MARK: - fetchDir

    /// Fetches a directory's children and merges them into the tree.
    /// Mirrors `fetchDir(dirPath)` in `file-store.ts:143-170`.
    func fetchDir(dirPath: String) async {
        if loadingDirs.contains(dirPath) { return }
        loadingDirs.insert(dirPath)
        do {
            let resp: FileListDirResponse = try await client.request(
                .fileListDir,
                payload: ["path": dirPath]
            )
            loadingDirs.remove(dirPath)
            if let currentTree = tree {
                tree = Self.mergeDir(currentTree, dirPath: dirPath, children: resp.entries)
            }
        } catch {
            loadingDirs.remove(dirPath)
        }
    }

    // MARK: - fetchGitStatus

    /// Fetches git status for the given path.
    /// Mirrors `fetchGitStatus(path)` in `file-store.ts:171-180`.
    func fetchGitStatus(path: String) async {
        gitStatusRequestId += 1
        let requestId = gitStatusRequestId
        // Clear status only when switching to a different repo path
        if gitStatusPath != path {
            gitStatus = nil
            gitStatusPath = nil
        }
        do {
            let resp: GitStatusResponse = try await client.request(
                .gitStatus,
                payload: ["path": path]
            )
            if requestId != gitStatusRequestId { return }  // stale — drop
            gitStatus = resp.status
            gitStatusPath = path
        } catch {}
    }

    // MARK: - watchPath / unwatchPath

    /// Begins watching a path for file-system changes.
    /// Mirrors `watchPath(path)` in `file-store.ts:181-222`.
    /// Phase-5 seam: the diff-store subscription is not yet wired.
    func watchPath(path: String) async {
        let previousPath = watchedPath
        if previousPath == path { return }

        if !fileChangeSubscriptionReady {
            fileChangeSubscriptionReady = true
            // Lazy one-time registration, matching the TS fileChangeSubscriptionReady guard.
            // Mirrors file-store.ts:186-204: collect parent dir, debounce 150ms,
            // refetch each loaded dir + git status.
            client.on(.fileChanged) { [weak self] (event: FileChangeEvent) in
                Task { @MainActor [weak self] in
                    guard let self, let wp = watchedPath, event.path.hasPrefix(wp) else { return }
                    pendingChangedPaths.insert(event.path)
                    changeDebounce?.cancel()
                    changeDebounce = Task { @MainActor [weak self] in
                        try? await Task.sleep(for: .milliseconds(150))
                        if Task.isCancelled { return }
                        guard let self, let wp = watchedPath else { return }
                        let loaded = Self.loadedDirSet(tree)
                        let toRefresh = Self.changedDirsToRefresh(
                            eventPaths: Array(pendingChangedPaths), watchedPath: wp, loadedDirs: loaded)
                        pendingChangedPaths.removeAll()
                        for dir in toRefresh { await fetchDir(dirPath: dir) }
                        await fetchGitStatus(path: wp)
                    }
                }
            }
        }

        if let prev = previousPath {
            _ = try? await client.requestRaw(.fileUnwatch, payload: ["path": prev])
            watchedPath = nil
        }

        _ = try? await client.requestRaw(.fileWatch, payload: ["path": path])
        watchedPath = path
    }

    /// Stops watching the given path.
    /// Mirrors `unwatchPath(path)` in `file-store.ts:224-232`.
    func unwatchPath(path: String) async {
        if watchedPath != path { return }
        // diff-store unsubscribe is handled centrally in AppEnvironment (single shared DiffViewModel).
        _ = try? await client.requestRaw(.fileUnwatch, payload: ["path": path])
        watchedPath = nil
    }

    /// Re-fetches git status for the currently-watched path. Wired in `AppEnvironment` to
    /// `DiffViewModel.onStatsByProjectChanged`, mirroring the `useDiffStore.subscribe` in
    /// `file-store.ts:209-220` that refreshes status when diff stats change.
    func refreshGitStatusForWatchedPath() {
        guard let wp = watchedPath else { return }
        Task { [weak self] in await self?.fetchGitStatus(path: wp) }
    }

    // MARK: - clearExplorerState

    /// Resets all explorer state and bumps both request ids to invalidate in-flight responses.
    /// Mirrors `clearExplorerState()` in `file-store.ts:233-248`.
    func clearExplorerState() {
        treeRequestId += 1
        gitStatusRequestId += 1
        tree = nil
        treePath = nil
        gitignorePatterns = []
        gitStatus = nil
        gitStatusPath = nil
        loading = false
        loadingDirs = []
        expandedDirs = []
        focusedPath = nil
        contextMenuPath = nil
    }

    // MARK: - expandToPathAndLoad

    /// Expands and loads all ancestor directories up to `targetPath`.
    /// Mirrors `expandToPathAndLoad(targetPath)` in `file-store.ts:249-279`.
    func expandToPathAndLoad(targetPath: String) async {
        guard let tp = treePath, targetPath.hasPrefix(tp) else { return }

        // Collect ancestor dirs from root to target (inclusive), shallowest first
        var dirsToLoad: [String] = []
        var current = targetPath
        while current != tp && current.count > tp.count {
            guard let lastSlash = current.lastIndex(of: "/") else { break }
            current = String(current[..<lastSlash])
            if current.count >= tp.count {
                dirsToLoad.insert(current, at: 0)
            }
        }

        // Load unloaded dirs sequentially (each depends on its parent being in the tree)
        for dir in dirsToLoad {
            if let currentTree = tree, !Self.isDirLoaded(currentTree, dir) {
                await fetchDir(dirPath: dir)
            }
        }

        // Expand all ancestor dirs
        var expanded = expandedDirs
        for dir in dirsToLoad {
            expanded.insert(dir)
        }
        expandedDirs = expanded
    }

    // MARK: - File operations

    /// Returns the text content of the file at `path`.
    /// Mirrors `readFile(path)` in `file-store.ts:280-283`.
    func readFile(path: String) async throws -> String {
        let resp: FileReadResponse = try await client.request(.fileRead, payload: ["path": path])
        return resp.content
    }

    /// Writes `content` to `path` and refreshes git status if under the watched path.
    /// Mirrors `writeFile(path, content)` in `file-store.ts:284-288`.
    func writeFile(path: String, content: String) async throws {
        _ = try await client.requestRaw(.fileWrite, payload: ["path": path, "content": content])
        if let wp = watchedPath, path.hasPrefix(wp) {
            await fetchGitStatus(path: wp)
        }
    }

    /// Renames / moves a file. Mirrors `renameFile(oldPath, newPath)` in `file-store.ts:289-291`.
    func renameFile(oldPath: String, newPath: String) async throws {
        _ = try await client.requestRaw(.fileRename, payload: ["oldPath": oldPath, "newPath": newPath])
    }

    /// Deletes a file. Mirrors `deleteFile(path)` in `file-store.ts:292-294`.
    func deleteFile(path: String) async throws {
        _ = try await client.requestRaw(.fileDelete, payload: ["path": path])
    }

    /// Creates a new empty file. Mirrors `createFile(path)` in `file-store.ts:295-297`.
    func createFile(path: String) async throws {
        _ = try await client.requestRaw(.fileWrite, payload: ["path": path, "content": ""])
    }

    /// Creates a directory. Mirrors `createDirectory(path)` in `file-store.ts:298-300`.
    func createDirectory(path: String) async throws {
        _ = try await client.requestRaw(.fileMkdir, payload: ["path": path])
    }

    /// Opens a file in the system default application.
    /// Mirrors `openExternal(path)` in `file-store.ts:301-303`.
    func openExternal(path: String) async throws {
        _ = try await client.requestRaw(.fileOpenExternal, payload: ["path": path])
    }

    /// Reveals a file in Finder.
    /// Mirrors `revealInFinder(path)` in `file-store.ts:304-306`.
    func revealInFinder(path: String) async throws {
        _ = try await client.requestRaw(.fileReveal, payload: ["path": path])
    }

    // MARK: - toggleDir / expandDir / collapseDir

    /// Toggles expansion of `path`. If newly expanded and children aren't loaded, fetches them.
    /// Mirrors `toggleDir(path)` in `file-store.ts:307-320`.
    func toggleDir(_ path: String) {
        if expandedDirs.contains(path) {
            expandedDirs.remove(path)
        } else {
            expandedDirs.insert(path)
            if let currentTree = tree, !Self.isDirLoaded(currentTree, path) {
                Task { [weak self] in await self?.fetchDir(dirPath: path) }
            }
        }
    }

    /// Expands `path` (no-op if already expanded). Fetches children if not yet loaded.
    /// Mirrors `expandDir(path)` in `file-store.ts:322-330`.
    func expandDir(_ path: String) {
        if expandedDirs.contains(path) { return }
        expandedDirs.insert(path)
        if let currentTree = tree, !Self.isDirLoaded(currentTree, path) {
            Task { [weak self] in await self?.fetchDir(dirPath: path) }
        }
    }

    /// Collapses `path` (no-op if not expanded).
    /// Mirrors `collapseDir(path)` in `file-store.ts:331-335`.
    func collapseDir(_ path: String) {
        if !expandedDirs.contains(path) { return }
        expandedDirs.remove(path)
    }

    // MARK: - Simple setters

    /// Mirrors `setFocusedPath` in `file-store.ts:336-338`.
    func setFocusedPath(_ path: String?) { focusedPath = path }

    /// Mirrors `setContextMenuPath` in `file-store.ts:339-341`.
    func setContextMenuPath(_ path: String?) { contextMenuPath = path }

    /// Mirrors `setDragOverPath` in `file-store.ts:347-349`.
    func setDragOverPath(_ path: String?) { dragOverPath = path }

    /// Sets the pending drag-move operation and clears `dragOverPath`.
    /// Mirrors `setPendingMove(move)` in `file-store.ts:350-352`.
    func setPendingMove(_ move: PendingMove) {
        pendingMove = move
        dragOverPath = nil
    }

    /// Clears the pending drag-move operation.
    /// Mirrors `clearPendingMove()` in `file-store.ts:353-355`.
    func clearPendingMove() {
        pendingMove = nil
    }

    // MARK: - Static Pure Reducers

    /// From a batch of changed file paths, returns the sorted, de-duplicated set of currently-
    /// loaded directories that need to be refetched.
    /// Mirrors file-store.ts: for each event path under `watchedPath`, derive the parent dir
    /// and keep only dirs already present in `loadedDirs`.
    static func changedDirsToRefresh(
        eventPaths: [String], watchedPath: String, loadedDirs: Set<String>
    ) -> [String] {
        var dirs = Set<String>()
        for p in eventPaths where p.hasPrefix(watchedPath) {
            guard let slash = p.lastIndex(of: "/") else { continue }
            let parent = String(p[..<slash])
            if loadedDirs.contains(parent) { dirs.insert(parent) }
        }
        return dirs.sorted()
    }

    /// Recursively collects the path of every directory node that has been loaded.
    /// Used by the `file:changed` debounce to know which dirs the tree currently holds.
    private static func loadedDirSet(_ node: FileNode?) -> Set<String> {
        guard let node else { return [] }
        var result = Set<String>()
        if node.type == "directory" && node.loaded == true {
            result.insert(node.path)
        }
        for child in node.children ?? [] {
            result.formUnion(loadedDirSet(child))
        }
        return result
    }

    /// Recursively replaces a directory node's children at `dirPath` with `children` in an
    /// immutable `FileNode` tree, marking the target node `loaded: true`.
    /// Returns the modified tree, or `nil` if `tree` is `nil`.
    /// No-op (returns unchanged tree) if `dirPath` is not found.
    /// Mirrors `setChildrenAtPath` from `file-store.ts:14-28`.
    static func mergeDir(_ tree: FileNode?, dirPath: String, children: [FileNode]) -> FileNode? {
        guard let root = tree else { return nil }
        return setChildrenAtPath(root, targetPath: dirPath, children: children)
    }

    // MARK: - Private helpers

    private static func setChildrenAtPath(
        _ root: FileNode,
        targetPath: String,
        children: [FileNode]
    ) -> FileNode {
        if root.path == targetPath {
            return FileNode(
                name: root.name,
                path: root.path,
                type: root.type,
                children: children,
                loaded: true,
                gitStatus: root.gitStatus
            )
        }
        guard let existingChildren = root.children else { return root }
        let newChildren = existingChildren.map { child -> FileNode in
            guard child.type == "directory",
                  targetPath == child.path || targetPath.hasPrefix(child.path + "/") else {
                return child
            }
            return setChildrenAtPath(child, targetPath: targetPath, children: children)
        }
        return FileNode(
            name: root.name,
            path: root.path,
            type: root.type,
            children: newChildren,
            loaded: root.loaded,
            gitStatus: root.gitStatus
        )
    }

    /// Returns `true` if the directory at `dirPath` has been loaded (its children are present).
    /// Mirrors `isDirLoaded` from `file-store.ts:30-42`.
    private static func isDirLoaded(_ root: FileNode, _ dirPath: String) -> Bool {
        if root.path == dirPath { return root.loaded == true }
        guard let children = root.children else { return false }
        for child in children {
            guard child.type == "directory",
                  dirPath == child.path || dirPath.hasPrefix(child.path + "/") else {
                continue
            }
            if isDirLoaded(child, dirPath) { return true }
        }
        return false
    }
}
