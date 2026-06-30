import XCTest
@testable import Taskflow

final class FlowActionEntryCodecTests: XCTestCase {
    func testRoundTripReference() throws {
        let ref = FlowActionReferenceEntry(id: "e1", label: "Lint", actionId: "a1")
        let raw = FlowActionEntryCodec.encode([.reference(ref)])
        let back = FlowActionEntryCodec.decode(raw)
        XCTAssertEqual(back, [.reference(ref)])
    }
    func testRoundTripInline() throws {
        let inline = FlowActionInlineEntry(id: "e2", label: nil,
            inline: ActionInline(name: "Build", prompt: "make", sessionType: .shell, agentOptions: nil))
        let raw = FlowActionEntryCodec.encode([.inline(inline)])
        XCTAssertEqual(FlowActionEntryCodec.decode(raw), [.inline(inline)])
    }
    func testDiscriminatesByPresenceOfActionIdVsInline() throws {
        // A raw entry carrying `actionId` decodes as .reference; one carrying `inline` decodes as .inline
        let entries = [
            FlowActionEntryKind.reference(.init(id: "e1", label: nil, actionId: "a1")),
            FlowActionEntryKind.inline(.init(id: "e2", label: "x",
                inline: ActionInline(name: "n", prompt: "p", sessionType: .claude, agentOptions: nil))),
        ]
        XCTAssertEqual(FlowActionEntryCodec.decode(FlowActionEntryCodec.encode(entries)), entries)
    }
    func testIdAccessor() {
        XCTAssertEqual(FlowActionEntryKind.reference(.init(id: "e9", label: nil, actionId: "a")).id, "e9")
    }
}
