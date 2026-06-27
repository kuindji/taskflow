import SwiftUI

@MainActor
final class AppEnvironment: ObservableObject {
    enum Status: Equatable { case connecting, connected(port: Int), failed(String) }
    @Published private(set) var status: Status = .connecting
    let themeStore = ThemeStore()
    private let sidecar: SidecarManager
    private(set) var client: WSClient?

    init() {
        let repoRoot = ProcessInfo.processInfo.environment["TASKFLOW_REPO_ROOT"].map(URL.init(fileURLWithPath:))
        sidecar = SidecarManager(resourcesURL: Bundle.main.resourceURL, devRepoRoot: repoRoot)
    }

    func boot() async {
        do {
            let client = try await sidecar.start()
            self.client = client
            // A real round-trip beyond the health check: count tasks.
            let data = try await client.requestRaw(.taskList, payload: [:])
            struct Resp: Decodable { let tasks: [TaskItem] }
            let resp = try JSONDecoder().decode(Resp.self, from: data)
            NSLog("Phase2 smoke: task:list returned \(resp.tasks.count) tasks")
            status = .connected(port: 0)
        } catch {
            status = .failed("\(error)")
        }
    }

    func shutdown() { sidecar.stop() }
}
