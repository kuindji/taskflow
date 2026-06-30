import XCTest
@testable import Taskflow

@MainActor
final class SettingsCatalogViewModelTests: XCTestCase {
    func testIsAvailableTrueWhenPresentAndAvailable() {
        let agents = [AgentAvailability(type: .claude, available: true, path: "/x", version: "1")]
        XCTAssertTrue(SettingsCatalogViewModel.isAvailable(.claude, in: agents))
        XCTAssertFalse(SettingsCatalogViewModel.isAvailable(.codex, in: agents))
    }
    func testIsAvailableFalseWhenMarkedUnavailable() {
        let agents = [AgentAvailability(type: .claude, available: false, path: "", version: "")]
        XCTAssertFalse(SettingsCatalogViewModel.isAvailable(.claude, in: agents))
    }
    func testInitialRemoteNotRunning() {
        let vm = SettingsCatalogViewModel(client: WSClient(url: URL(string: "ws://localhost:1")!))
        XCTAssertFalse(vm.remoteRunning)
    }
}
