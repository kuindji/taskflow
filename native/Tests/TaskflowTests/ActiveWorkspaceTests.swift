import XCTest
@testable import Taskflow

final class ActiveWorkspaceTests: XCTestCase {
    func testMasterReturnsHomedir() {
        XCTAssertEqual(
            ActiveWorkspace.workingDir(task: nil, project: nil, masterActive: true, homedir: "/Users/me"),
            "/Users/me")
    }

    func testMasterWithNilHomedirReturnsNil() {
        XCTAssertNil(
            ActiveWorkspace.workingDir(task: nil, project: nil, masterActive: true, homedir: nil))
    }

    func testTaskWithWorktreeUsesWorktreePath() {
        let task = makeTask(worktreeEnabled: true, worktreePath: "/wt/branch")
        let project = makeProject(path: "/repo")
        XCTAssertEqual(
            ActiveWorkspace.workingDir(task: task, project: project, masterActive: false, homedir: nil),
            "/wt/branch")
    }

    func testTaskWithoutWorktreeUsesProjectPath() {
        let task = makeTask(worktreeEnabled: false, worktreePath: nil)
        let project = makeProject(path: "/repo")
        XCTAssertEqual(
            ActiveWorkspace.workingDir(task: task, project: project, masterActive: false, homedir: nil),
            "/repo")
    }

    func testProjectOnlyUsesProjectPath() {
        XCTAssertEqual(
            ActiveWorkspace.workingDir(task: nil, project: makeProject(path: "/repo"),
                                       masterActive: false, homedir: nil),
            "/repo")
    }

    func testNothingActiveReturnsNil() {
        XCTAssertNil(
            ActiveWorkspace.workingDir(task: nil, project: nil, masterActive: false, homedir: nil))
    }

    // Helpers — match the generated memberwise initializers.
    private func makeTask(worktreeEnabled: Bool, worktreePath: String?) -> TaskItem {
        TaskItem(
            id: "t1", projectId: "p1", parentId: nil, title: "Task", description: "",
            notes: "", worktree: TaskWorktree(enabled: worktreeEnabled, path: worktreePath,
                                              branch: nil, pr: nil),
            sessions: [], createdAt: "0", status: "active", archivedAt: nil, pinned: false,
            initCommand: nil
        )
    }

    private func makeProject(path: String) -> Project {
        Project(
            id: "p1", name: "Proj", path: path, sessions: [], createdAt: "0",
            defaultInitCommand: nil, prompt: nil, linkedProjects: nil,
            hidden: nil, locationValid: nil
        )
    }
}
