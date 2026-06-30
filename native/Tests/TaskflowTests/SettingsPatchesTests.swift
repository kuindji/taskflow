import XCTest
@testable import Taskflow

final class SettingsPatchesTests: XCTestCase {
    private func json<T: Encodable>(_ v: T) throws -> String {
        let enc = JSONEncoder()
        enc.outputFormatting = [.sortedKeys]
        return String(data: try enc.encode(v), encoding: .utf8)!
    }

    func testSingleFieldPatchOmitsNilSiblings() throws {
        let patch = SettingsPatch(general: GeneralPatch(confirmBeforeExit: true))
        XCTAssertEqual(try json(patch), #"{"general":{"confirmBeforeExit":true}}"#)
    }

    func testEnumFieldEncodesRawString() throws {
        let patch = SettingsPatch(codex: CodexPatch(sandbox: .workspaceWrite))
        XCTAssertEqual(try json(patch), #"{"codex":{"sandbox":"workspace-write"}}"#)
    }

    func testAppearanceThemePatch() throws {
        let patch = SettingsPatch(appearance: AppearancePatch(theme: "dracula"))
        XCTAssertEqual(try json(patch), #"{"appearance":{"theme":"dracula"}}"#)
    }

    func testFontResetEmitsExplicitNulls() throws {
        // reset must send null (not omit) so the backend re-expands to defaults
        let s = try json(FontResetPatch())
        XCTAssertTrue(s.contains(#""fontFamily":null"#))
        XCTAssertTrue(s.contains(#""fontSize":null"#))
        // covers general + terminal + editor
        XCTAssertTrue(s.contains(#""general":"#))
        XCTAssertTrue(s.contains(#""terminal":"#))
        XCTAssertTrue(s.contains(#""editor":"#))
    }
}
