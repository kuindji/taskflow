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
        let env = SidecarSupport.childEnvironment(
            base: base, portFile: "/tmp/pf", rgPath: "/bin/rg", sandboxHome: nil)
        XCTAssertNil(env["CLAUDECODE"])
        XCTAssertNil(env["CLAUDE_CODE_ENTRYPOINT"])
        XCTAssertEqual(env["TASKFLOW_PORT_FILE"], "/tmp/pf")
        XCTAssertEqual(env["TASKFLOW_RG_PATH"], "/bin/rg")
        XCTAssertEqual(env["PATH"], "/usr/bin")
    }

    func testChildEnvironmentWithoutSandboxLeavesHomeAndDevUntouched() {
        let base = ["HOME": "/Users/real"]
        let env = SidecarSupport.childEnvironment(
            base: base, portFile: "/tmp/pf", rgPath: nil, sandboxHome: nil)
        XCTAssertEqual(env["HOME"], "/Users/real")
        XCTAssertNil(env["TASKFLOW_DEV"])
        XCTAssertNil(env["TASKFLOW_RG_PATH"])  // nil rgPath sets nothing
    }

    func testChildEnvironmentWithSandboxOverridesHomeAndEnablesDev() {
        let base = ["HOME": "/Users/real", "PATH": "/usr/bin"]
        let env = SidecarSupport.childEnvironment(
            base: base, portFile: "/tmp/pf", rgPath: nil, sandboxHome: "/Users/real/.taskflow-native-dev")
        XCTAssertEqual(env["HOME"], "/Users/real/.taskflow-native-dev")
        XCTAssertEqual(env["TASKFLOW_DEV"], "1")
        XCTAssertEqual(env["PATH"], "/usr/bin")  // unrelated vars preserved
        XCTAssertEqual(env["TASKFLOW_PORT_FILE"], "/tmp/pf")
    }

    func testResolveSandboxHomeDefaultsToNamespacedSandbox() {
        let home = SidecarSupport.resolveSandboxHome(base: ["HOME": "/Users/real"])
        XCTAssertEqual(home, "/Users/real/.taskflow-native-dev")
        // Distinct from the real config dir so it can never collide.
        XCTAssertNotEqual(home, "/Users/real")
    }

    func testResolveSandboxHomeOptsOutForProductionData() {
        let home = SidecarSupport.resolveSandboxHome(
            base: ["HOME": "/Users/real", "TASKFLOW_NATIVE_PROD_DATA": "1"])
        XCTAssertNil(home)
    }

    func testWsURLBuildsLocalhost() {
        XCTAssertEqual(SidecarSupport.wsURL(port: 8080).absoluteString, "ws://localhost:8080")
    }
}
