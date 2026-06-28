import XCTest
@testable import Taskflow

final class DiffViewModelTests: XCTestCase {
    private func stats(add: Double, del: Double, branch: String?, ahead: Double, behind: Double,
                       hasChanges: Bool = true, diffDisabled: Bool = false,
                       commitDisabled: Bool = false) -> ChangeStats {
        ChangeStats(additions: add, deletions: del, fileCount: 1, branch: branch,
                    ahead: ahead, behind: behind, hasChanges: hasChanges,
                    diffDisabled: diffDisabled, commitDisabled: commitDisabled)
    }

    func testApplyPopulatesAllMaps() {
        let s = DiffViewModel.apply(DiffState(), ChangeStatsEvent(
            targetId: "t1", stats: stats(add: 5, del: 2, branch: "main", ahead: 1, behind: 3)))
        XCTAssertEqual(s.statsByProject["t1"], DiffStats(additions: 5, deletions: 2))
        XCTAssertEqual(s.behindByProject["t1"], 3)
        XCTAssertEqual(s.aheadByProject["t1"], 1)
        XCTAssertEqual(s.branchByProject["t1"], "main")
        XCTAssertEqual(s.hasChangesByProject["t1"], true)
    }

    func testZeroAdditionsAndDeletionsClearsStatsButKeepsOtherMaps() {
        let s = DiffViewModel.apply(DiffState(), ChangeStatsEvent(
            targetId: "t1", stats: stats(add: 0, del: 0, branch: "dev", ahead: 0, behind: 4)))
        XCTAssertNil(s.statsByProject["t1"])           // null diffStats, mirrors TS
        XCTAssertEqual(s.behindByProject["t1"], 4)     // other maps still set
        XCTAssertEqual(s.branchByProject["t1"], "dev")
    }

    func testNullStatsRemovesTargetFromAllMaps() {
        var seed = DiffState()
        seed = DiffViewModel.apply(seed, ChangeStatsEvent(
            targetId: "t1", stats: stats(add: 5, del: 2, branch: "main", ahead: 1, behind: 3)))
        let cleared = DiffViewModel.apply(seed, ChangeStatsEvent(targetId: "t1", stats: nil))
        XCTAssertNil(cleared.statsByProject["t1"])
        XCTAssertNil(cleared.behindByProject["t1"])
        XCTAssertNil(cleared.branchByProject["t1"])
        XCTAssertNil(cleared.hasChangesByProject["t1"])
    }

    func testNullBranchRemovesBranchKey() {
        let s = DiffViewModel.apply(DiffState(), ChangeStatsEvent(
            targetId: "t1", stats: stats(add: 1, del: 0, branch: nil, ahead: 0, behind: 0)))
        XCTAssertNil(s.branchByProject["t1"])
    }
}
