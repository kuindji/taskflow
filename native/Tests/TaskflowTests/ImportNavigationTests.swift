import XCTest
@testable import Taskflow

final class ImportNavigationTests: XCTestCase {

    // MARK: - specifier(inLine:column:)

    func testExtractsDoubleQuotedSpecifierUnderCursor() {
        // Column 22 (1-based) lands on `f` inside "./foo/bar"
        let line = #"import { x } from "./foo/bar";"#
        XCTAssertEqual(ImportNavigation.specifier(inLine: line, column: 22), "./foo/bar")
    }

    func testExtractsSingleQuotedSpecifier() {
        // Column 18 (1-based) lands on `c` inside '@scope/pkg'
        let line = "import y from '@scope/pkg'"
        XCTAssertEqual(ImportNavigation.specifier(inLine: line, column: 18), "@scope/pkg")
    }

    func testReturnsNilOutsideAnySpecifier() {
        // Line has no import/export/require/from keyword — always nil
        XCTAssertNil(ImportNavigation.specifier(inLine: #"const a = 1;"#, column: 4))
    }

    func testRequireSpecifier() {
        // Column 22 (1-based) lands on `u` inside "./util"
        let line = #"const m = require("./util")"#
        XCTAssertEqual(ImportNavigation.specifier(inLine: line, column: 22), "./util")
    }

    // MARK: - Additional edge cases

    func testReturnsNilWhenCursorIsBeforeSpecifier() {
        // Column 5 (1-based) lands on `r` in `import` keyword, not in the quoted specifier
        let line = #"import { x } from "./foo";"#
        XCTAssertNil(ImportNavigation.specifier(inLine: line, column: 5))
    }

    func testReturnsNilWhenCursorIsAfterSpecifier() {
        // Column 30 (1-based) lands on `;` after the closing quote
        let line = #"import { x } from "./foo/bar";"#
        XCTAssertNil(ImportNavigation.specifier(inLine: line, column: 30))
    }

    func testExportFromSpecifier() {
        // export ... from 'specifier' — should also be captured
        let line = "export { y } from './lib'"
        // Column 20 lands on `l` inside `./lib`
        XCTAssertEqual(ImportNavigation.specifier(inLine: line, column: 20), "./lib")
    }

    func testBareImportSpecifier() {
        // import 'side-effect' — no `from`, just import + string
        let line = #"import "side-effect""#
        // Column 10 lands on `d` inside `side-effect`
        XCTAssertEqual(ImportNavigation.specifier(inLine: line, column: 10), "side-effect")
    }
}
