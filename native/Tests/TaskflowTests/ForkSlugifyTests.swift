import XCTest
@testable import Taskflow

final class ForkSlugifyTests: XCTestCase {
    func testLowercasesAndDashesSlashesAndSpaces() {
        XCTAssertEqual(ForkProjectDialog.slugify("Feature/My Branch"), "feature-my-branch")
    }
    func testStripsDisallowedChars() {
        XCTAssertEqual(ForkProjectDialog.slugify("fix#123!"), "fix123")
    }
    func testKeepsDotsAndDigits() {
        XCTAssertEqual(ForkProjectDialog.slugify("v1.2.3"), "v1.2.3")
    }
    func testParentDir() {
        XCTAssertEqual(ForkProjectDialog.parentDir("/Users/me/projects/app"), "/Users/me/projects")
    }
}
