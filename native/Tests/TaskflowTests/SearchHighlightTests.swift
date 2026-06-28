import XCTest
@testable import Taskflow

final class SearchHighlightTests: XCTestCase {
    func testSplitsLineAroundMatch() {
        // 1-based column, like the backend. "let x = 1", match "x" at column 5, length 1.
        let parts = SearchResultsView.splitLine("let x = 1", column: 5, matchLength: 1)
        XCTAssertEqual(parts.before, "let ")
        XCTAssertEqual(parts.match, "x")
        XCTAssertEqual(parts.after, " = 1")
    }

    func testClampsOutOfRangeColumn() {
        let parts = SearchResultsView.splitLine("abc", column: 99, matchLength: 5)
        XCTAssertEqual(parts.before + parts.match + parts.after, "abc")  // no crash, lossless
    }
}
