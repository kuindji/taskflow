import XCTest
@testable import Taskflow

@MainActor
final class UIViewModelTests: XCTestCase {
    func testSidebarWidthClamps() {
        let vm = UIViewModel()
        vm.setSidebarWidth(10);   XCTAssertEqual(vm.sidebarWidth, 180)   // lo
        vm.setSidebarWidth(9999); XCTAssertEqual(vm.sidebarWidth, 350)   // hi
        vm.setSidebarWidth(220);  XCTAssertEqual(vm.sidebarWidth, 220)
    }

    func testToggleSplitOpensWithDefaults() {
        let vm = UIViewModel()
        vm.toggleSplit("task:a")
        let s = vm.getSplit("task:a")
        XCTAssertEqual(s, WorkspaceSplit(open: true, ratio: 0.5, activePane: .left))
        vm.toggleSplit("task:a")
        XCTAssertEqual(vm.getSplit("task:a")?.open, false)               // closes
    }

    func testSetSplitRatioClamps() {
        let vm = UIViewModel(); vm.toggleSplit("task:a")
        vm.setSplitRatio("task:a", 0.05); XCTAssertEqual(vm.getSplit("task:a")?.ratio, 0.2)
        vm.setSplitRatio("task:a", 0.95); XCTAssertEqual(vm.getSplit("task:a")?.ratio, 0.8)
        vm.setSplitRatio("task:a", 0.42); XCTAssertEqual(vm.getSplit("task:a")?.ratio, 0.42)
    }

    func testFileExplorerAndSearchMutuallyExclusive() {
        let vm = UIViewModel()
        vm.fileExplorerOpen = true; vm.openSearchPanel()
        XCTAssertTrue(vm.searchPanelOpen); XCTAssertFalse(vm.fileExplorerOpen)
    }

    func testToggleSplitReopenPreservesRatio() {
        let vm = UIViewModel()
        vm.toggleSplit("task:a")
        vm.setSplitRatio("task:a", 0.7)
        vm.toggleSplit("task:a")   // close
        vm.toggleSplit("task:a")   // reopen
        XCTAssertEqual(vm.getSplit("task:a")?.ratio, 0.7)
    }

    func testWidthSettersClamp() {
        let vm = UIViewModel()
        vm.setFileExplorerWidth(10);   XCTAssertEqual(vm.fileExplorerWidth, 150)
        vm.setFileExplorerWidth(9999); XCTAssertEqual(vm.fileExplorerWidth, 500)
        vm.setTaskInfoWidth(10);       XCTAssertEqual(vm.taskInfoWidth, 150)
        vm.setTaskInfoWidth(9999);     XCTAssertEqual(vm.taskInfoWidth, 500)
        vm.setFlowPanelWidth(10);      XCTAssertEqual(vm.flowPanelWidth, 150)
        vm.setFlowPanelWidth(9999);    XCTAssertEqual(vm.flowPanelWidth, 400)
    }
}
