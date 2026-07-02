import XCTest
@testable import Taskflow

final class FileContextMenuTests: XCTestCase {
    func testShellSessionLabelUsesBasename() {
        XCTAssertEqual(FileContextMenu.shellSessionLabel("/bin/zsh"), "zsh")
        XCTAssertEqual(FileContextMenu.shellSessionLabel("pwsh"), "pwsh")
    }

    func testShellSessionLabelFallsBackForEmptyPath() {
        XCTAssertEqual(FileContextMenu.shellSessionLabel(""), "shell")
    }
}
