import XCTest
import CodeEditLanguages
@testable import Taskflow

final class LanguageDetectionTests: XCTestCase {
    func testSwift() {
        XCTAssertEqual(LanguageDetection.language(forPath: "/a/b.swift").id, CodeLanguage.swift.id)
    }

    func testTypeScript() {
        XCTAssertEqual(LanguageDetection.language(forPath: "/a/b.ts").id, CodeLanguage.typescript.id)
    }

    func testTSX() {
        XCTAssertEqual(LanguageDetection.language(forPath: "/a/b.tsx").id, CodeLanguage.tsx.id)
    }

    func testJSON() {
        XCTAssertEqual(LanguageDetection.language(forPath: "/a/b.json").id, CodeLanguage.json.id)
    }

    func testUnknownFallsBackToDefault() {
        XCTAssertEqual(
            LanguageDetection.language(forPath: "/a/b.unknownext").id,
            CodeLanguage.default.id
        )
    }
}
