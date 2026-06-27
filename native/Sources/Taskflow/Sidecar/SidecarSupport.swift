import Foundation

enum SidecarSupport {
    /// Host-session identity env vars that must never leak into the sidecar or its
    /// descendants. TASKFLOW_PORT_FILE is intentionally excluded — it is overridden
    /// to the sandbox port file in `childEnvironment`, not stripped.
    static let productionIdentityVars = [
        "TASKFLOW_API_URL", "TASKFLOW_SESSION_ID", "TASKFLOW_TASK_ID", "TASKFLOW_PROJECT_ID",
    ]

    static func parsePort(_ contents: String) -> Int? {
        let trimmed = contents.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let port = Int(trimmed), port >= 1024, port <= 65535 else { return nil }
        return port
    }

    static func childEnvironment(
        base: [String: String],
        portFile: String,
        rgPath: String?,
        sandboxHome: String?
    ) -> [String: String] {
        var env = base
        env.removeValue(forKey: "CLAUDECODE")
        env.removeValue(forKey: "CLAUDE_CODE_ENTRYPOINT")
        // Strip the host Taskflow session's identity so neither the sidecar nor
        // anything it later spawns (agent shells, embedded terminals running
        // `taskflow-cli`) can address or impersonate the user's PRODUCTION
        // instance. `taskflow-cli` targets a backend purely via TASKFLOW_API_URL,
        // and the backend tags/clears sessions by the *_ID identity — leaking
        // these is how a native test run reaches the live app.
        for key in productionIdentityVars { env.removeValue(forKey: key) }
        env["TASKFLOW_PORT_FILE"] = portFile
        if let rgPath { env["TASKFLOW_RG_PATH"] = rgPath }
        if let sandboxHome {
            // Isolate the spawned backend's config/data dir + session logs from any
            // production Taskflow already running on this machine: getConfigBaseDir()
            // resolves ~/.config/taskflow from HOME, and TASKFLOW_DEV namespaces the
            // instanceId + session-logs dir. Without this, a dev run shares the live
            // data dir and its schedulers/change-trackers, which crashes the host app.
            env["HOME"] = sandboxHome
            env["TASKFLOW_DEV"] = "1"
        }
        return env
    }

    /// Where the spawned backend should keep its data, or nil to use the real
    /// (production) home. Defaults to a sandboxed home so a development run can
    /// never collide with a production Taskflow on the same machine. The eventual
    /// production cutover opts back into the real data dir via TASKFLOW_NATIVE_PROD_DATA=1.
    static func resolveSandboxHome(base: [String: String]) -> String? {
        if base["TASKFLOW_NATIVE_PROD_DATA"] == "1" { return nil }
        let realHome = base["HOME"] ?? NSHomeDirectory()
        return realHome + "/.taskflow-native-dev"
    }

    static func wsURL(port: Int) -> URL {
        URL(string: "ws://localhost:\(port)")!
    }
}
