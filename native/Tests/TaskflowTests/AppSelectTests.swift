import XCTest
@testable import Taskflow

final class AppSelectTests: XCTestCase {
    func testReturnsLabelForPresentValue() {
        let opts = [AppSelect<String>.Option(value: "a", label: "Alpha"),
                    AppSelect<String>.Option(value: "b", label: "Bravo")]
        XCTAssertEqual(AppSelect<String>.label(for: "b", in: opts), "Bravo")
    }
    func testReturnsNilForAbsentValue() {
        let opts = [AppSelect<String>.Option(value: "a", label: "Alpha")]
        XCTAssertNil(AppSelect<String>.label(for: "z", in: opts))
    }
    func testWorksForOptionalEnumValue() {
        typealias Opt = AppSelect<ClaudeEffortLevel?>.Option
        let opts = [Opt(value: nil, label: "Default"), Opt(value: .high, label: "High")]
        XCTAssertEqual(AppSelect<ClaudeEffortLevel?>.label(for: nil, in: opts), "Default")
        XCTAssertEqual(AppSelect<ClaudeEffortLevel?>.label(for: .high, in: opts), "High")
    }
}
