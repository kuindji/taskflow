import XCTest
@testable import Taskflow

@MainActor
final class ProjectViewModelTests: XCTestCase {
    // Test-only Project factory — keeps production types clean.
    private func project(_ id: String, name: String = "n") -> Project {
        Project(
            id: id, name: name, path: "/\(id)", sessions: [], createdAt: "0",
            defaultInitCommand: nil, prompt: nil, linkedProjects: nil,
            hidden: nil, locationValid: nil
        )
    }

    // Review fix: SessionViewModel sync is driven by this hook; every mutation of `projects`
    // must fire it (the native analogue of the web app's useEffect on [projects]).
    func testProjectsMutationFiresOnProjectsChanged() async {
        let client = WSClient(url: URL(string: "ws://localhost:1")!)
        let vm = ProjectViewModel(client: client)
        vm.bind()
        var received: [Project]?
        vm.onProjectsChanged = { received = $0 }
        let payload = Data(#"{"id":"p1","name":"n","path":"/p1","sessions":[],"createdAt":"0"}"#.utf8)
        client.handleInbound(.event(type: "project:created", payload: payload))
        for _ in 0..<100 {  // the bind() handler hops through a Task; yield until it lands
            if received != nil { break }
            await Task.yield()
        }
        XCTAssertEqual(received?.map(\.id), ["p1"], "mutating projects must notify onProjectsChanged")
    }

    // applyReorder: listed ids come first in given order; remaining keep original order at end
    func testApplyReorderMovesListedIdsToFront() {
        let ps = [project("a"), project("b"), project("c")]
        let out = ProjectViewModel.applyReorder(ps, orderedIds: ["c", "a"])
        XCTAssertEqual(out.map(\.id), ["c", "a", "b"])
    }

    // applyReorder: unknown ids in orderedIds are silently ignored
    func testApplyReorderIgnoresUnknownIds() {
        let ps = [project("a"), project("b")]
        let out = ProjectViewModel.applyReorder(ps, orderedIds: ["z", "b", "a"])
        XCTAssertEqual(out.map(\.id), ["b", "a"])
    }

    // applyReorder: duplicate ids in orderedIds are applied only on first occurrence
    func testApplyReorderDedupInOrderedIds() {
        let ps = [project("a"), project("b")]
        let out = ProjectViewModel.applyReorder(ps, orderedIds: ["a", "a", "b"])
        XCTAssertEqual(out.map(\.id), ["a", "b"])
    }

    // applyReorder: empty orderedIds leaves list unchanged
    func testApplyReorderEmptyOrderPreservesOriginal() {
        let ps = [project("a"), project("b")]
        let out = ProjectViewModel.applyReorder(ps, orderedIds: [])
        XCTAssertEqual(out.map(\.id), ["a", "b"])
    }

    // applyUpdated: replaces the matching project in place
    func testApplyUpdatedReplacesInPlace() {
        let ps = [project("a"), project("b"), project("c")]
        let out = ProjectViewModel.applyUpdated(ps, project("b", name: "updated"))
        XCTAssertEqual(out.map(\.id), ["a", "b", "c"])
        XCTAssertEqual(out[1].name, "updated")
    }

    // applyUpdated: unknown id leaves list unchanged
    func testApplyUpdatedUnknownIdNoChange() {
        let ps = [project("a"), project("b")]
        let out = ProjectViewModel.applyUpdated(ps, project("z"))
        XCTAssertEqual(out.map(\.id), ["a", "b"])
    }

    // applyRemoved: drops the project with the given id
    func testApplyRemovedDropsById() {
        let ps = [project("a"), project("b"), project("c")]
        let out = ProjectViewModel.applyRemoved(ps, id: "b")
        XCTAssertEqual(out.map(\.id), ["a", "c"])
    }

    // applyRemoved: missing id is a no-op
    func testApplyRemovedMissingIdNoOp() {
        let ps = [project("a"), project("b")]
        let out = ProjectViewModel.applyRemoved(ps, id: "z")
        XCTAssertEqual(out.map(\.id), ["a", "b"])
    }

    // applyCreated: appends a project not yet in the list
    func testApplyCreatedAppends() {
        let ps = [project("a")]
        let out = ProjectViewModel.applyCreated(ps, project("b"))
        XCTAssertEqual(out.map(\.id), ["a", "b"])
    }

    // applyCreated: does not append if id already exists (dedup)
    func testApplyCreatedDeduplicate() {
        let ps = [project("a"), project("b")]
        let out = ProjectViewModel.applyCreated(ps, project("a"))
        XCTAssertEqual(out.map(\.id), ["a", "b"])
    }
}
