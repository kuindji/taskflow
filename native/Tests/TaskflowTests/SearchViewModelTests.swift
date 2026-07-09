import XCTest
@testable import Taskflow

@MainActor
final class SearchViewModelTests: XCTestCase {

    // MARK: - Helpers

    private func makeMatch(line: Double, column: Double = 0) -> SearchMatch {
        SearchMatch(line: line, column: column, matchLength: 5, lineContent: "hello world")
    }

    private func makeFileResult(path: String, matches: [SearchMatch]) -> SearchFileResult {
        SearchFileResult(path: path, matches: matches)
    }

    private func makeVM() -> SearchViewModel {
        SearchViewModel(client: WSClient(url: URL(string: "ws://localhost:1")!))
    }

    private func makeResponse(path: String, searchId: String = "sid") -> SearchQueryResponse {
        SearchQueryResponse(result: SearchResult(
            files: [makeFileResult(path: path, matches: [makeMatch(line: 1)])],
            totalMatches: 1, searchId: searchId))
    }

    // MARK: - Stale-response guard (review fix: slow response must not clobber a newer search)

    func testStaleSearchResponseIsIgnored() async {
        let vm = makeVM()
        vm.setQuery("foo")
        await vm.search(rootPath: "/r")   // generation 1 (fails fast: client not connected)
        await vm.search(rootPath: "/r")   // generation 2
        vm.applySearchResponse(makeResponse(path: "stale.ts"), generation: 1)
        XCTAssertTrue(vm.results.isEmpty, "a response from a superseded search must be dropped")
        vm.applySearchResponse(makeResponse(path: "fresh.ts"), generation: 2)
        XCTAssertEqual(vm.results.map(\.path), ["fresh.ts"], "the current generation must still apply")
    }

    func testStaleSearchFailureIsIgnored() async {
        let vm = makeVM()
        vm.setQuery("foo")
        await vm.search(rootPath: "/r")   // generation 1: fails, sets error
        let currentError = vm.error
        XCTAssertNotNil(currentError)
        vm.applySearchFailure(WSClient.WSClientError.timeout, generation: 0)
        XCTAssertEqual(vm.error, currentError, "a stale failure must not overwrite newer state")
    }

    func testClearInvalidatesInFlightSearch() async {
        let vm = makeVM()
        vm.setQuery("foo")
        await vm.search(rootPath: "/r")   // generation 1
        vm.clear()                        // must invalidate the in-flight generation
        vm.applySearchResponse(makeResponse(path: "late.ts"), generation: 1)
        XCTAssertTrue(vm.results.isEmpty, "a response arriving after clear() must be dropped")
        XCTAssertNil(vm.searchId)
    }

    func testEmptyQuerySearchClearsSearchingAndInvalidates() async {
        let vm = makeVM()
        let generation = vm.beginSearch()   // in-flight request, spinner on
        vm.setQuery("")
        await vm.search(rootPath: "/r")     // empty-query branch invalidates the in-flight search
        XCTAssertFalse(vm.searching,
                       "the empty-query reset must clear the spinner — the invalidated response can no longer do it")
        vm.applySearchResponse(makeResponse(path: "late.ts"), generation: generation)
        XCTAssertTrue(vm.results.isEmpty, "the invalidated response must stay a no-op")
    }

    func testCancelBeforeResponseClearsSearching() async {
        let vm = makeVM()
        _ = vm.beginSearch()          // in-flight request, no searchId assigned yet
        XCTAssertTrue(vm.searching)
        await vm.cancel()
        XCTAssertFalse(vm.searching,
                       "cancel during the pre-searchId window must clear the spinner — the invalidated response can no longer do it")
    }

    func testCancelInvalidatesInFlightSearch() async {
        let vm = makeVM()
        vm.setQuery("foo")
        await vm.search(rootPath: "/r")   // generation 1
        await vm.cancel()                 // must invalidate the in-flight generation
        vm.applySearchResponse(makeResponse(path: "late.ts"), generation: 1)
        XCTAssertTrue(vm.results.isEmpty, "a response arriving after cancel() must be dropped")
    }

    // MARK: - toggleExpanded (static pure reducer)

    func testToggleExpandedAddsPath() {
        let result = SearchViewModel.toggleExpanded(Set(), "file.ts")
        XCTAssertTrue(result.contains("file.ts"))
    }

    func testToggleExpandedRemovesExistingPath() {
        let result = SearchViewModel.toggleExpanded(Set(["file.ts"]), "file.ts")
        XCTAssertFalse(result.contains("file.ts"))
    }

    func testToggleExpandedDoesNotAffectOtherPaths() {
        let result = SearchViewModel.toggleExpanded(Set(["a.ts", "b.ts"]), "a.ts")
        XCTAssertFalse(result.contains("a.ts"))
        XCTAssertTrue(result.contains("b.ts"))
    }

    func testToggleExpandedIsIdempotentAddThenAdd() {
        // Adding an already-absent path adds it; adding the same path again removes it
        let added = SearchViewModel.toggleExpanded(Set(), "x.ts")
        XCTAssertTrue(added.contains("x.ts"))
        let removed = SearchViewModel.toggleExpanded(added, "x.ts")
        XCTAssertFalse(removed.contains("x.ts"))
    }

    // MARK: - removeMatch (static pure reducer)

    func testRemoveMatchDropsOneMatch() {
        let m1 = makeMatch(line: 1)
        let m2 = makeMatch(line: 2)
        let results = [makeFileResult(path: "f.ts", matches: [m1, m2])]
        let out = SearchViewModel.removeMatch(results, file: "f.ts", match: m1)
        XCTAssertEqual(out.count, 1)
        XCTAssertEqual(out[0].matches.count, 1)
        XCTAssertEqual(out[0].matches[0].line, 2)
    }

    func testRemoveMatchDropsFileWhenLastMatchRemoved() {
        // When the last match in a file is removed, the file entry is also dropped.
        // Matches search-store.ts: `if (filtered.length === 0) return null`
        let m1 = makeMatch(line: 1)
        let results = [makeFileResult(path: "f.ts", matches: [m1])]
        let out = SearchViewModel.removeMatch(results, file: "f.ts", match: m1)
        XCTAssertTrue(out.isEmpty)
    }

    func testRemoveMatchDoesNotAffectOtherFiles() {
        let m1 = makeMatch(line: 1)
        let results = [
            makeFileResult(path: "a.ts", matches: [m1]),
            makeFileResult(path: "b.ts", matches: [makeMatch(line: 2)])
        ]
        let out = SearchViewModel.removeMatch(results, file: "a.ts", match: m1)
        XCTAssertEqual(out.count, 1)
        XCTAssertEqual(out[0].path, "b.ts")
    }

    func testRemoveMatchIdentifiesByLineAndColumn() {
        // Two matches on the same line at different columns — only the one with column 0 is removed.
        let m1 = makeMatch(line: 1, column: 0)
        let m2 = makeMatch(line: 1, column: 10)
        let results = [makeFileResult(path: "f.ts", matches: [m1, m2])]
        let out = SearchViewModel.removeMatch(results, file: "f.ts", match: m1)
        XCTAssertEqual(out[0].matches.count, 1)
        XCTAssertEqual(out[0].matches[0].column, 10)
    }

    func testRemoveMatchUnknownFileIsNoOp() {
        let m1 = makeMatch(line: 1)
        let results = [makeFileResult(path: "a.ts", matches: [m1])]
        let out = SearchViewModel.removeMatch(results, file: "other.ts", match: m1)
        XCTAssertEqual(out.count, 1)
        XCTAssertEqual(out[0].matches.count, 1)
    }
}
