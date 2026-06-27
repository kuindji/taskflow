import XCTest
@testable import Taskflow

@MainActor
final class FileViewModelTests: XCTestCase {

    // MARK: - Helpers

    private func makeClient() -> WSClient {
        WSClient(url: URL(string: "ws://localhost:0")!)
    }

    private func makeDir(
        _ name: String,
        _ path: String,
        children: [FileNode]? = nil,
        loaded: Bool? = nil
    ) -> FileNode {
        FileNode(name: name, path: path, type: "directory", children: children, loaded: loaded, gitStatus: nil)
    }

    private func makeFile(_ name: String, _ path: String) -> FileNode {
        FileNode(name: name, path: path, type: "file", children: nil, loaded: nil, gitStatus: nil)
    }

    // MARK: - toggleDir (set membership)

    func testToggleDirAddsPathWhenNotExpanded() {
        let vm = FileViewModel(client: makeClient())
        XCTAssertFalse(vm.expandedDirs.contains("/root"))
        vm.toggleDir("/root")
        XCTAssertTrue(vm.expandedDirs.contains("/root"))
    }

    func testToggleDirRemovesPathWhenAlreadyExpanded() {
        let vm = FileViewModel(client: makeClient())
        vm.toggleDir("/root")
        XCTAssertTrue(vm.expandedDirs.contains("/root"))
        vm.toggleDir("/root")
        XCTAssertFalse(vm.expandedDirs.contains("/root"))
    }

    func testToggleDirDoesNotAffectOtherPaths() {
        let vm = FileViewModel(client: makeClient())
        vm.toggleDir("/root/a")
        vm.toggleDir("/root/b")
        vm.toggleDir("/root/a")  // collapse /root/a
        XCTAssertFalse(vm.expandedDirs.contains("/root/a"))
        XCTAssertTrue(vm.expandedDirs.contains("/root/b"))
    }

    // MARK: - expandDir (set membership)

    func testExpandDirAddsPath() {
        let vm = FileViewModel(client: makeClient())
        vm.expandDir("/root")
        XCTAssertTrue(vm.expandedDirs.contains("/root"))
    }

    func testExpandDirIsIdempotentWhenAlreadyExpanded() {
        let vm = FileViewModel(client: makeClient())
        vm.expandDir("/root")
        vm.expandDir("/root")
        XCTAssertTrue(vm.expandedDirs.contains("/root"))
        XCTAssertEqual(vm.expandedDirs.count, 1)
    }

    // MARK: - collapseDir (set membership)

    func testCollapseDirRemovesPath() {
        let vm = FileViewModel(client: makeClient())
        vm.expandDir("/root")
        XCTAssertTrue(vm.expandedDirs.contains("/root"))
        vm.collapseDir("/root")
        XCTAssertFalse(vm.expandedDirs.contains("/root"))
    }

    func testCollapseDirIsNoOpWhenNotExpanded() {
        let vm = FileViewModel(client: makeClient())
        XCTAssertFalse(vm.expandedDirs.contains("/root"))
        vm.collapseDir("/root")  // must not crash or add the path
        XCTAssertFalse(vm.expandedDirs.contains("/root"))
        XCTAssertTrue(vm.expandedDirs.isEmpty)
    }

    // MARK: - mergeDir (static pure reducer)

    func testMergeDirReplacesChildrenAtExactPath() {
        // Build a small tree: /root -> [/root/src (unloaded)]
        let srcNode = makeDir("src", "/root/src", children: nil, loaded: nil)
        let root = makeDir("root", "/root", children: [srcNode], loaded: true)
        let newChildren = [makeFile("main.swift", "/root/src/main.swift")]

        let result = FileViewModel.mergeDir(root, dirPath: "/root/src", children: newChildren)

        XCTAssertNotNil(result)
        let mergedSrc = result?.children?.first(where: { $0.path == "/root/src" })
        XCTAssertNotNil(mergedSrc, "src node must exist after merge")
        XCTAssertEqual(mergedSrc?.children?.count, 1)
        XCTAssertEqual(mergedSrc?.children?.first?.name, "main.swift")
        XCTAssertEqual(mergedSrc?.loaded, true, "merged node must be marked loaded")
    }

    func testMergeDirReplacesRootNode() {
        // When dirPath matches the root itself, replace its children directly
        let root = makeDir("root", "/root", children: [], loaded: true)
        let newChildren = [makeDir("src", "/root/src")]

        let result = FileViewModel.mergeDir(root, dirPath: "/root", children: newChildren)

        XCTAssertNotNil(result)
        XCTAssertEqual(result?.children?.count, 1)
        XCTAssertEqual(result?.children?.first?.path, "/root/src")
        XCTAssertEqual(result?.loaded, true)
    }

    func testMergeDirReplacesAtDeepNestedPath() {
        // /root -> [/root/src -> [/root/src/utils (unloaded)]]
        let utilsNode = makeDir("utils", "/root/src/utils", children: nil, loaded: nil)
        let srcNode = makeDir("src", "/root/src", children: [utilsNode], loaded: true)
        let root = makeDir("root", "/root", children: [srcNode], loaded: true)
        let newChildren = [makeFile("helpers.swift", "/root/src/utils/helpers.swift")]

        let result = FileViewModel.mergeDir(root, dirPath: "/root/src/utils", children: newChildren)

        XCTAssertNotNil(result)
        let src = result?.children?.first(where: { $0.path == "/root/src" })
        let utils = src?.children?.first(where: { $0.path == "/root/src/utils" })
        XCTAssertNotNil(utils, "utils node must exist after deep merge")
        XCTAssertEqual(utils?.children?.count, 1)
        XCTAssertEqual(utils?.children?.first?.name, "helpers.swift")
        XCTAssertEqual(utils?.loaded, true)
    }

    func testMergeDirIsNoOpForUnknownPath() {
        // dirPath not found in tree → tree returned unchanged
        let root = makeDir("root", "/root", children: [
            makeDir("src", "/root/src", children: [], loaded: true)
        ], loaded: true)

        let result = FileViewModel.mergeDir(root, dirPath: "/unknown/path", children: [makeFile("x.swift", "/unknown/path/x.swift")])

        XCTAssertNotNil(result)
        XCTAssertEqual(result?.children?.count, 1)
        XCTAssertEqual(result?.children?.first?.path, "/root/src")
        // src must still have empty children (not modified)
        XCTAssertEqual(result?.children?.first?.children?.count, 0)
    }

    func testMergeDirNilTreeReturnsNil() {
        let result = FileViewModel.mergeDir(nil, dirPath: "/root", children: [])
        XCTAssertNil(result)
    }
}
