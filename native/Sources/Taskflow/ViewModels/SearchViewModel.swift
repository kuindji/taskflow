import Foundation
import Observation

/// 1:1 port of `packages/ui/src/stores/search-store.ts`.
///
/// Behavioral notes:
/// - No WS subscriptions (`bind()` is not needed).
/// - `search` cancels any in-progress search before starting a new one, mirrors the TS guard
///   `if (state.searchId) await get().cancel()`. An empty query clears state without an RPC.
/// - `search` expands all result files on success (matching the TS loop over `response.result.files`).
/// - `cancel` ignores RPC errors (matching TS `// Ignore cancel errors`).
/// - `replaceMatch` / `replaceInFile` / `replaceAll` call the static `removeMatch` / instance
///   `removeFile` helpers after a successful RPC, mirroring the TS `get().removeMatch` /
///   `get().removeFile` calls.
/// - `clear` resets only the fields the TS store resets; search flags and patterns are NOT cleared.
/// - `totalMatches` is `Int` in the Swift model; converted from `Double` on server responses
///   (matching the codegen convention for JSON numbers).
///
/// Type note: `removeMatch` uses `match: SearchMatch` (not a synthetic string id) because the TS
/// source identifies matches by `(line, column)` — and `SearchMatch` is `Equatable` by those fields.
@MainActor
@Observable
final class SearchViewModel {
    var query: String = ""
    var replacement: String = ""
    var caseSensitive: Bool = false
    var wholeWord: Bool = false
    var useRegex: Bool = false
    var includePattern: String = ""
    var excludePattern: String = ""
    private(set) var results: [SearchFileResult] = []
    private(set) var totalMatches: Int = 0
    private(set) var searchId: String? = nil
    private(set) var searching: Bool = false
    private(set) var expandedFiles: Set<String> = []
    private(set) var error: String? = nil

    @ObservationIgnored private let client: WSClient

    init(client: WSClient) {
        self.client = client
    }

    // MARK: - Simple setters (mirror TS `setQuery`, `setReplacement`, etc.)

    func setQuery(_ value: String) { query = value }
    func setReplacement(_ value: String) { replacement = value }
    func setIncludePattern(_ value: String) { includePattern = value }
    func setExcludePattern(_ value: String) { excludePattern = value }

    func toggleCaseSensitive() { caseSensitive = !caseSensitive }
    func toggleWholeWord() { wholeWord = !wholeWord }
    func toggleUseRegex() { useRegex = !useRegex }

    // MARK: - Async actions

    /// Searches with the current query. Mirrors `search` in `search-store.ts`.
    func search(rootPath: String) async {
        if query.isEmpty {
            results = []
            totalMatches = 0
            searchId = nil
            error = nil
            return
        }
        if searchId != nil {
            await cancel()
        }
        searching = true
        error = nil
        do {
            let resp: SearchQueryResponse = try await client.request(.searchQuery, payload: [
                "path": rootPath,
                "query": query,
                "caseSensitive": caseSensitive,
                "wholeWord": wholeWord,
                "useRegex": useRegex,
                "includePattern": includePattern,
                "excludePattern": excludePattern
            ])
            results = resp.result.files
            totalMatches = Int(resp.result.totalMatches)
            searchId = resp.result.searchId
            searching = false
            expandedFiles = Set(resp.result.files.map(\.path))
        } catch {
            searching = false
            self.error = error.localizedDescription
        }
    }

    /// Cancels the current search. Mirrors `cancel` in `search-store.ts`.
    func cancel() async {
        guard let id = searchId else { return }
        // Ignore cancel errors (matches TS `catch { // Ignore cancel errors }`)
        try? await client.requestRaw(.searchCancel, payload: ["searchId": id])
        searchId = nil
        searching = false
    }

    /// Replaces a single match and removes it from local results. Mirrors `replaceMatch`.
    func replaceMatch(rootPath: String, filePath: String, match: SearchMatch) async {
        do {
            let matchData = try JSONEncoder().encode([match])
            let matchesArr = try JSONSerialization.jsonObject(with: matchData)
            _ = try await client.requestRaw(.searchReplace, payload: [
                "path": rootPath,
                "filePath": filePath,
                "query": query,
                "replacement": replacement,
                "caseSensitive": caseSensitive,
                "wholeWord": wholeWord,
                "useRegex": useRegex,
                "matches": matchesArr
            ])
            removeMatch(filePath: filePath, match: match)
        } catch {
            self.error = error.localizedDescription
        }
    }

    /// Replaces all matches in a single file and removes the file from local results.
    /// Mirrors `replaceInFile` in `search-store.ts`.
    func replaceInFile(rootPath: String, filePath: String) async {
        do {
            _ = try await client.requestRaw(.searchReplaceAll, payload: [
                "path": rootPath,
                "query": query,
                "replacement": replacement,
                "caseSensitive": caseSensitive,
                "wholeWord": wholeWord,
                "useRegex": useRegex,
                "includePattern": includePattern,
                "excludePattern": excludePattern,
                "filePath": filePath
            ])
            removeFile(filePath: filePath)
        } catch {
            self.error = error.localizedDescription
        }
    }

    /// Replaces all matches across all files (or a single file if `filePath` is provided).
    /// Mirrors `replaceAll` in `search-store.ts`.
    func replaceAll(rootPath: String, filePath: String? = nil) async {
        do {
            var payload: [String: Any] = [
                "path": rootPath,
                "query": query,
                "replacement": replacement,
                "caseSensitive": caseSensitive,
                "wholeWord": wholeWord,
                "useRegex": useRegex,
                "includePattern": includePattern,
                "excludePattern": excludePattern
            ]
            if let filePath { payload["filePath"] = filePath }
            _ = try await client.requestRaw(.searchReplaceAll, payload: payload)
            if let filePath {
                removeFile(filePath: filePath)
            } else {
                results = []
                totalMatches = 0
            }
        } catch {
            self.error = error.localizedDescription
        }
    }

    // MARK: - Synchronous mutations

    /// Toggles the expanded state of a file path. Mirrors `toggleFileExpanded`.
    func toggleFileExpanded(path: String) {
        expandedFiles = Self.toggleExpanded(expandedFiles, path)
    }

    /// Removes a single match and drops the file entry if it becomes empty.
    /// Mirrors `removeMatch` in `search-store.ts`.
    func removeMatch(filePath: String, match: SearchMatch) {
        let newResults = Self.removeMatch(results, file: filePath, match: match)
        results = newResults
        totalMatches = newResults.reduce(0) { $0 + $1.matches.count }
    }

    /// Removes an entire file entry and recalculates `totalMatches`.
    /// Mirrors `removeFile` in `search-store.ts`.
    func removeFile(filePath: String) {
        let newResults = results.filter { $0.path != filePath }
        results = newResults
        totalMatches = newResults.reduce(0) { $0 + $1.matches.count }
    }

    /// Resets query/replacement/results/searchId/searching/expandedFiles/error to initial values.
    /// Flags (`caseSensitive`, `wholeWord`, `useRegex`) and patterns are NOT cleared — matches TS.
    func clear() {
        query = ""
        replacement = ""
        results = []
        totalMatches = 0
        searchId = nil
        searching = false
        expandedFiles = []
        error = nil
    }

    // MARK: - Pure Reducers (static, TDD'd)

    /// Mirrors `removeMatch` in `search-store.ts`:
    /// removes the given match from the named file, comparing ONLY by `line` + `column`
    /// (matching the TS predicate `m.line !== match.line || m.column !== match.column`).
    /// If the file's match list becomes empty, the file entry is also removed.
    ///
    /// Parameter `match: SearchMatch` (not `matchId: String`) because the TS source identifies
    /// matches by `(line, column)` — there is no synthetic id field.
    static func removeMatch(
        _ results: [SearchFileResult],
        file: String,
        match: SearchMatch
    ) -> [SearchFileResult] {
        results.compactMap { fileResult in
            guard fileResult.path == file else { return fileResult }
            let filtered = fileResult.matches.filter {
                $0.line != match.line || $0.column != match.column
            }
            return filtered.isEmpty ? nil : SearchFileResult(path: fileResult.path, matches: filtered)
        }
    }

    /// Mirrors `toggleFileExpanded` in `search-store.ts`:
    /// adds `file` to the set if absent, removes it if present.
    static func toggleExpanded(_ set: Set<String>, _ file: String) -> Set<String> {
        var copy = set
        if copy.contains(file) {
            copy.remove(file)
        } else {
            copy.insert(file)
        }
        return copy
    }
}
