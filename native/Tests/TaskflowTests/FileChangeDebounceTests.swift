import XCTest
@testable import Taskflow

@MainActor
final class FileChangeDebounceTests: XCTestCase {
    func testIgnoresPathsOutsideWatchedRoot() {
        let out = FileViewModel.changedDirsToRefresh(
            eventPaths: ["/other/x.ts"], watchedPath: "/repo", loadedDirs: ["/repo"])
        XCTAssertTrue(out.isEmpty)
    }
    func testCollectsParentDirOfChangedFileWhenLoaded() {
        let out = FileViewModel.changedDirsToRefresh(
            eventPaths: ["/repo/src/a.ts"], watchedPath: "/repo", loadedDirs: ["/repo", "/repo/src"])
        XCTAssertEqual(out, ["/repo/src"])
    }
    func testSkipsParentDirNotLoaded() {
        let out = FileViewModel.changedDirsToRefresh(
            eventPaths: ["/repo/src/a.ts"], watchedPath: "/repo", loadedDirs: ["/repo"])
        XCTAssertTrue(out.isEmpty)   // /repo/src not loaded → nothing to refresh
    }
    func testDedupesMultipleChangesInSameDir() {
        let out = FileViewModel.changedDirsToRefresh(
            eventPaths: ["/repo/src/a.ts", "/repo/src/b.ts"], watchedPath: "/repo",
            loadedDirs: ["/repo", "/repo/src"])
        XCTAssertEqual(out, ["/repo/src"])
    }
}
