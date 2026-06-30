import XCTest
@testable import Taskflow

@MainActor
final class ModelListViewModelTests: XCTestCase {
    func testApplyCursorMapsModels() {
        let out = ModelListViewModel.applyCursor(CursorModelsResponse(models: [CursorModel(id: "gpt-5", label: "GPT-5")]))
        XCTAssertEqual(out.first?.id, "gpt-5")
        XCTAssertEqual(out.first?.label, "GPT-5")
    }
    func testApplyPiMapsModels() {
        let out = ModelListViewModel.applyPi(PiModelsResponse(models: [
            PiModelInfo(provider: "anthropic", id: "opus", contextWindow: "200k", maxOutput: "64k", supportsThinking: true, supportsImages: false)
        ]))
        XCTAssertEqual(out.first.map { "\($0.provider)/\($0.id)" }, "anthropic/opus")
    }
    func testApplyOpenCodeMapsModels() {
        let out = ModelListViewModel.applyOpenCode(OpenCodeModelsResponse(models: [OpenCodeModelInfo(id: "anthropic/claude", provider: "anthropic")]))
        XCTAssertEqual(out.first?.id, "anthropic/claude")
        XCTAssertEqual(out.first?.provider, "anthropic")
    }
    func testInitialStateNotLoaded() {
        let vm = ModelListViewModel(client: WSClient(url: URL(string: "ws://localhost:1")!))
        XCTAssertFalse(vm.cursorLoaded)
        XCTAssertFalse(vm.cursorFailed)
        XCTAssertTrue(vm.cursor.isEmpty)
    }
}
