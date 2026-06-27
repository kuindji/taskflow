import XCTest
@testable import Taskflow

final class DiffParseTests: XCTestCase {
    func testClassifiesLineKinds() {
        let diff = """
        diff --git a/x.ts b/x.ts
        @@ -1,2 +1,2 @@
         context
        -old
        +new
        """
        let lines = DiffView.parse(diff)
        XCTAssertEqual(lines.map(\.kind), [.fileHeader, .hunkHeader, .context, .deletion, .addition])
    }

    func testStripsLeadingMarkerFromText() {
        let lines = DiffView.parse("+added")
        XCTAssertEqual(lines.first?.kind, .addition)
        XCTAssertEqual(lines.first?.text, "added")
    }

    func testEmptyDiffIsEmpty() { XCTAssertTrue(DiffView.parse("").isEmpty) }

    func testIndexLineIsFileHeader() {
        let lines = DiffView.parse("index abc123..def456 100644")
        XCTAssertEqual(lines.first?.kind, .fileHeader)
    }

    func testDashDashDashIsFileHeader() {
        let lines = DiffView.parse("--- a/foo.ts")
        XCTAssertEqual(lines.first?.kind, .fileHeader)
    }

    func testPlusPlusPlusIsFileHeader() {
        let lines = DiffView.parse("+++ b/foo.ts")
        XCTAssertEqual(lines.first?.kind, .fileHeader)
    }

    func testContextLineStripsLeadingSpace() {
        let lines = DiffView.parse(" unchanged line")
        XCTAssertEqual(lines.first?.kind, .context)
        XCTAssertEqual(lines.first?.text, "unchanged line")
    }

    func testDeletionStripsLeadingDash() {
        let lines = DiffView.parse("-removed")
        XCTAssertEqual(lines.first?.kind, .deletion)
        XCTAssertEqual(lines.first?.text, "removed")
    }

    func testUnknownLineIsContext() {
        let lines = DiffView.parse("no marker here")
        XCTAssertEqual(lines.first?.kind, .context)
        XCTAssertEqual(lines.first?.text, "no marker here")
    }
}
