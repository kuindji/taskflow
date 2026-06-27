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
