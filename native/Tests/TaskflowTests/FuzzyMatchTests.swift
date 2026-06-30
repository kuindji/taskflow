import XCTest
@testable import Taskflow

final class FuzzyMatchTests: XCTestCase {
    func testEmptyQueryMatchesWithZeroScoreOffset() {
        // Empty query is a subsequence of everything: no matched chars, score 0*100 - length.
        let r = FuzzyMatch.match("", "build")
        XCTAssertEqual(r, FuzzyResult(score: -5, indices: []))
    }

    func testNonSubsequenceReturnsNil() {
        XCTAssertNil(FuzzyMatch.match("zzz", "build"))
        XCTAssertNil(FuzzyMatch.match("bx", "build"))   // 'x' not present after 'b'
    }

    func testCaseInsensitiveSubsequence() {
        XCTAssertNotNil(FuzzyMatch.match("BLD", "build"))
    }

    func testConsecutiveBonusBeatsScattered() {
        // "bu" consecutive at word start in "build" should outscore "bd" scattered in "bound".
        let consecutive = FuzzyMatch.match("bu", "build")!
        let scattered = FuzzyMatch.match("bd", "build")!
        XCTAssertGreaterThan(consecutive.score, scattered.score)
    }

    func testWordStartBonus() {
        // 'r' at the start of the word "run" (after a non-alnum boundary) earns the +3 word-start bonus.
        let atStart = FuzzyMatch.match("r", "run")!
        let midWord = FuzzyMatch.match("r", "abr")!
        XCTAssertGreaterThan(atStart.score, midWord.score)
    }

    func testShorterCandidateWinsTie() {
        // Same matched chars/bonuses, shorter text wins via the - length term.
        let shortText = FuzzyMatch.match("ab", "ab")!
        let longText = FuzzyMatch.match("ab", "abcdef")!
        XCTAssertGreaterThan(shortText.score, longText.score)
    }

    func testIndicesPointIntoOriginalString() {
        let r = FuzzyMatch.match("bd", "Build")!
        XCTAssertEqual(r.indices, [0, 4])   // 'B' at 0, 'd' at 4
    }
}
