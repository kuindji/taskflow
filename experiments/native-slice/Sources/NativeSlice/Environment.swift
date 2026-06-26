import Foundation

enum SliceEnv {
    static func backendURL() -> URL {
        let raw = ProcessInfo.processInfo.environment["TASKFLOW_API_URL"] ?? "http://localhost:63074"
        var comps = URLComponents(string: raw)!
        comps.scheme = (comps.scheme == "https") ? "wss" : "ws"
        return comps.url!
    }
}
