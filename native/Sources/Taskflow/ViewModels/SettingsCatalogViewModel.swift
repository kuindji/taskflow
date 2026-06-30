import Foundation
import Observation

/// Data sources for the Settings Defaults + Remote tabs. Port of SettingsModal's on-open
/// fetches (shells:list, runtimes:list, system:info, agents:list) + useRemoteAgentStatus().
///
/// `loadCatalog()` is called lazily on dialog open — it is NOT in `AppEnvironment.boot()`'s
/// parallel-load group. `bind()` registers the live `remote-agent:status-changed` subscription.
@MainActor
@Observable
final class SettingsCatalogViewModel {
    private(set) var shells: [ShellInfo] = []
    private(set) var systemShellPath: String?
    private(set) var runtimes: [RuntimeInfo] = []
    private(set) var editors: [EditorInfo] = []
    private(set) var agents: [AgentAvailability] = []
    private(set) var remoteRunning = false

    @ObservationIgnored private let client: WSClient
    @ObservationIgnored private var unsubscribe: (() -> Void)?

    init(client: WSClient) { self.client = client }

    // MARK: - Availability helpers

    nonisolated static func isAvailable(_ agent: AgentType, in agents: [AgentAvailability]) -> Bool {
        agents.first { $0.type == agent }?.available ?? false
    }

    func isAvailable(_ agent: AgentType) -> Bool {
        Self.isAvailable(agent, in: agents)
    }

    // MARK: - Load

    /// Parallel best-effort fetch of all catalog data, then refreshes remote status.
    /// Called lazily when the Settings dialog opens.
    func loadCatalog() async {
        async let shellsR: ShellListResponse? = try? client.request(.shellsList, payload: [:])
        async let runtimesR: RuntimeListResponse? = try? client.request(.runtimesList, payload: [:])
        async let systemR: SystemInfo? = try? client.request(.systemInfo, payload: [:])
        async let agentsR: AgentListResponse? = try? client.request(.agentsList, payload: [:])
        if let r = await shellsR { shells = r.shells; systemShellPath = r.systemShellPath }
        if let r = await runtimesR { runtimes = r.runtimes }
        if let r = await systemR { editors = r.editors }
        if let r = await agentsR { agents = r.agents }
        await refreshRemoteStatus()
    }

    // MARK: - Remote agent status

    func refreshRemoteStatus() async {
        if let r: RemoteAgentStatusPayload = try? await client.request(.remoteAgentStatus, payload: [:]) {
            remoteRunning = r.running
        }
    }

    func startRemote() async {
        _ = try? await client.requestRaw(.remoteAgentStart, payload: [:])
        await refreshRemoteStatus()
    }

    func stopRemote() async {
        _ = try? await client.requestRaw(.remoteAgentStop, payload: [:])
        await refreshRemoteStatus()
    }

    // MARK: - Bind (WS event subscription)

    /// Registers the `remote-agent:status-changed` subscription. Call once from
    /// `AppEnvironment.compose(client:)`.
    func bind() {
        unsubscribe = client.on(.remoteAgentStatusChanged) { [weak self] (p: RemoteAgentStatusPayload) in
            Task { @MainActor in self?.remoteRunning = p.running }
        }
    }
}
