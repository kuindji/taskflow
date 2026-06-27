import XCTest
@testable import Taskflow

final class SidecarSupportTests: XCTestCase {
    func testParsePortAcceptsValidInteger() {
        XCTAssertEqual(SidecarSupport.parsePort("63074\n"), 63074)
        XCTAssertEqual(SidecarSupport.parsePort("  51000  "), 51000)
    }

    func testParsePortRejectsEmptyOrZeroOrPartial() {
        XCTAssertNil(SidecarSupport.parsePort(""))
        XCTAssertNil(SidecarSupport.parsePort("0"))
        XCTAssertNil(SidecarSupport.parsePort("12"))  // partial write: too small to be a real port
    }

    func testChildEnvironmentStripsClaudeVarsAndSetsPortFile() {
        let base = ["PATH": "/usr/bin", "CLAUDECODE": "1", "CLAUDE_CODE_ENTRYPOINT": "cli"]
        let env = SidecarSupport.childEnvironment(base: base, portFile: "/tmp/pf", rgPath: "/bin/rg")
        XCTAssertNil(env["CLAUDECODE"])
        XCTAssertNil(env["CLAUDE_CODE_ENTRYPOINT"])
        XCTAssertEqual(env["TASKFLOW_PORT_FILE"], "/tmp/pf")
        XCTAssertEqual(env["TASKFLOW_RG_PATH"], "/bin/rg")
        XCTAssertEqual(env["PATH"], "/usr/bin")
    }

    func testWsURLBuildsLocalhost() {
        XCTAssertEqual(SidecarSupport.wsURL(port: 8080).absoluteString, "ws://localhost:8080")
    }
}
