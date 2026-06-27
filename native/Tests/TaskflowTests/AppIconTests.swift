import XCTest
@testable import Taskflow

final class AppIconTests: XCTestCase {
    func testCommonMappings() {
        XCTAssertEqual(AppIcon.symbol(forLucide: "Plus"), "plus")
        XCTAssertEqual(AppIcon.symbol(forLucide: "Trash2"), "trash")
        XCTAssertEqual(AppIcon.symbol(forLucide: "ChevronRight"), "chevron.right")
        XCTAssertEqual(AppIcon.symbol(forLucide: "Bell"), "bell")
        XCTAssertEqual(AppIcon.symbol(forLucide: "GitBranch"), "arrow.triangle.branch")
        XCTAssertEqual(AppIcon.symbol(forLucide: "Settings2"), "gearshape")
        XCTAssertEqual(AppIcon.symbol(forLucide: "Workflow"), "flowchart")
    }
    func testIconSuffixAliasesAreEquivalent() {
        // lucide sometimes imports `X` and `XIcon`; both map to the same symbol.
        XCTAssertEqual(AppIcon.symbol(forLucide: "X"), AppIcon.symbol(forLucide: "XIcon"))
        XCTAssertEqual(AppIcon.symbol(forLucide: "Check"), AppIcon.symbol(forLucide: "CheckIcon"))
    }
    func testUnknownNameFallsBackToVisiblePlaceholder() {
        XCTAssertEqual(AppIcon.symbol(forLucide: "TotallyMadeUp"), "questionmark.square.dashed")
    }
}
