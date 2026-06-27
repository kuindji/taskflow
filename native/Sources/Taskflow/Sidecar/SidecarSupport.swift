import Foundation

enum SidecarSupport {
    static func parsePort(_ contents: String) -> Int? {
        let trimmed = contents.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let port = Int(trimmed), port >= 1024, port <= 65535 else { return nil }
        return port
    }

    static func childEnvironment(base: [String: String], portFile: String, rgPath: String?) -> [String: String] {
        var env = base
        env.removeValue(forKey: "CLAUDECODE")
        env.removeValue(forKey: "CLAUDE_CODE_ENTRYPOINT")
        env["TASKFLOW_PORT_FILE"] = portFile
        if let rgPath { env["TASKFLOW_RG_PATH"] = rgPath }
        return env
    }

    static func wsURL(port: Int) -> URL {
        URL(string: "ws://localhost:\(port)")!
    }
}
