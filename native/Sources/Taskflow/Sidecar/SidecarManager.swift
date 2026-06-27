import Foundation

@MainActor
final class SidecarManager {
    enum SidecarError: Error { case binaryNotFound, portTimeout, healthCheckFailed }

    private let resourcesURL: URL?   // packaged: .../Contents/Resources
    private let devRepoRoot: URL?    // dev fallback: run via `bun packages/backend/src/index.ts`
    private var process: Process?
    private var portFile: URL?
    private(set) var isRunning = false

    init(resourcesURL: URL?, devRepoRoot: URL?) {
        self.resourcesURL = resourcesURL
        self.devRepoRoot = devRepoRoot
    }

    func start() async throws -> WSClient {
        let pf = URL(fileURLWithPath: NSTemporaryDirectory())
            .appendingPathComponent("taskflow-port-\(ProcessInfo.processInfo.processIdentifier)-\(Int(Date().timeIntervalSince1970))")
        portFile = pf

        let proc = Process()
        let env = SidecarSupport.childEnvironment(
            base: ProcessInfo.processInfo.environment, portFile: pf.path, rgPath: resolveRipgrep())

        if let bin = packagedBinary() {
            proc.executableURL = bin
            proc.arguments = []
        } else if let root = devRepoRoot {
            proc.executableURL = URL(fileURLWithPath: "/usr/bin/env")
            proc.arguments = ["bun", "run", root.appendingPathComponent("packages/backend/src/index.ts").path]
        } else {
            throw SidecarError.binaryNotFound
        }
        proc.environment = env
        proc.standardOutput = FileHandle.nullDevice
        proc.standardError = FileHandle.nullDevice
        try proc.run()
        process = proc

        let port = try await waitForPort(pf, deadlineSeconds: 10)
        print("[SidecarManager] sidecar port \(port)")
        let client = WSClient(url: SidecarSupport.wsURL(port: port))
        client.connect()
        // Health check: system:info must round-trip.
        do {
            let data = try await client.requestRaw(.systemInfo, payload: [:])
            if let str = String(data: data, encoding: .utf8) {
                print("[SidecarManager] system:info response: \(str)")
            }
        } catch {
            throw SidecarError.healthCheckFailed
        }
        isRunning = true
        return client
    }

    func stop() {
        process?.terminate()
        process = nil
        isRunning = false
        if let pf = portFile { try? FileManager.default.removeItem(at: pf) }
        portFile = nil
    }

    private func packagedBinary() -> URL? {
        guard let res = resourcesURL else { return nil }
        let bin = res.appendingPathComponent("backend/taskflow-backend")
        return FileManager.default.isExecutableFile(atPath: bin.path) ? bin : nil
    }

    private func resolveRipgrep() -> String? {
        if let res = resourcesURL {
            let rg = res.appendingPathComponent("backend/rg").path
            if FileManager.default.isExecutableFile(atPath: rg) { return rg }
        }
        return nil
    }

    private func waitForPort(_ file: URL, deadlineSeconds: Double) async throws -> Int {
        let deadline = Date().addingTimeInterval(deadlineSeconds)
        while Date() < deadline {
            if process?.isRunning == false { throw SidecarError.portTimeout }
            if let contents = try? String(contentsOf: file, encoding: .utf8),
               let port = SidecarSupport.parsePort(contents) {
                return port
            }
            try? await Swift.Task.sleep(nanoseconds: 100_000_000) // 100ms
        }
        throw SidecarError.portTimeout
    }
}
