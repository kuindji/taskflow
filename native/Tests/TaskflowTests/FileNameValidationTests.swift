import XCTest
@testable import Taskflow

// TDD RED phase: tests written before implementation in FileDialogs.swift
final class FileNameValidationTests: XCTestCase {
    func testValidName() {
        XCTAssertTrue(FileNameValidation.isValidFileName("readme.txt"))
    }
    func testEmptyName() {
        XCTAssertFalse(FileNameValidation.isValidFileName(""))
    }
    func testWhitespaceOnly() {
        XCTAssertFalse(FileNameValidation.isValidFileName("   "))
    }
    func testContainsSlash() {
        XCTAssertFalse(FileNameValidation.isValidFileName("foo/bar"))
    }
    func testContainsNull() {
        XCTAssertFalse(FileNameValidation.isValidFileName("foo\0bar"))
    }
}
