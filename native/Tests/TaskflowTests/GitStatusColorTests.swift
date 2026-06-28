import XCTest
@testable import Taskflow

final class GitStatusColorTests: XCTestCase {
    func testStatusTokens() {
        XCTAssertEqual(GitStatusColor.token(forStatus: "new", isIgnored: false), .success)
        XCTAssertEqual(GitStatusColor.token(forStatus: "untracked", isIgnored: false), .success)
        XCTAssertEqual(GitStatusColor.token(forStatus: "modified", isIgnored: false), .warning)
        XCTAssertEqual(GitStatusColor.token(forStatus: "deleted", isIgnored: false), .destructive)
        XCTAssertEqual(GitStatusColor.token(forStatus: "renamed", isIgnored: false), .accent)
    }

    func testUnknownStatusIsClean() {
        XCTAssertEqual(GitStatusColor.token(forStatus: nil, isIgnored: false), .secondaryForeground)
        XCTAssertEqual(GitStatusColor.token(forStatus: "bogus", isIgnored: false), .secondaryForeground)
    }

    func testIgnoredAppliesOnlyWhenNoStatus() {
        XCTAssertEqual(GitStatusColor.token(forStatus: nil, isIgnored: true), .mutedForeground)
        // A real status wins over ignored (mirrors FileTree.tsx: rawStatus ? ... : isIgnored ? ...)
        XCTAssertEqual(GitStatusColor.token(forStatus: "modified", isIgnored: true), .warning)
    }

    func testGitFilesMapPrefersAbsolutePathAndUnstagedOverridesStaged() {
        let staged = GitFileStatus(path: "a.txt", absolutePath: nil, previousPath: nil,
                                   status: "new", staged: true)
        let unstaged = GitFileStatus(path: "a.txt", absolutePath: "/repo/a.txt", previousPath: nil,
                                     status: "modified", staged: false)
        let result = GitStatusResult(branch: "main", stagedFiles: [staged],
                                     unstagedFiles: [unstaged], ahead: 0, behind: 0)
        let map = GitStatusColor.gitFilesMap(result, workingDir: "/repo")
        // staged "a.txt" → "/repo/a.txt" (synthesized); unstaged overwrites with "modified"
        XCTAssertEqual(map["/repo/a.txt"], "modified")
    }
}
