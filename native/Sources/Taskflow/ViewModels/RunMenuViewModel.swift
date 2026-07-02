import Foundation
import Observation

// MARK: - RunMenuData

/// Data bag for the Run submenu.
/// Ports `RunMenuData` from `packages/ui/src/lib/run-menu.ts`.
///
/// The `agents: AgentAvailability[]` field is intentionally omitted: 5B treats all agents as
/// available (`// availability seam`). Real per-agent gating is deferred to a later phase.
/// `hasActiveFlowRun: Bool` replaces the TS `activeFlowRun: FlowRun | null` — the predicate
/// only needs the boolean, and `FlowRun` itself is not exposed here.
struct RunMenuData {
    var scripts: [String: String]
    var defaultRuntime: String
    var agentCommands: [AgentCommand]
    var flows: [FlowDefinition]
    var standaloneActions: [ActionDefinition]
    var hasActiveFlowRun: Bool
    var showAgentOptions: Bool
    var online: Bool
}

// MARK: - RunMenuCallbacks

/// Action closures for the Run submenu.
/// Ports `RunMenuCallbacks` from `packages/ui/src/lib/run-menu.ts`.
///
/// All closures dispatch async work via `Task { @MainActor ... }` internally.
/// 5B note: `onRunTab`/`onRunTabWithOptions` are present (non-optional, unlike the TS union
/// type where they are absent when `showAgentOptions` is false) — the caller gates rendering
/// on `RunMenuData.showAgentOptions`.
struct RunMenuCallbacks {
    var onRunScript: (String) -> Void
    var onRunAgentCommand: (AgentCommand) -> Void
    var onStartFlow: (String) -> Void
    var onRunAction: (ActionDefinition) -> Void
    var onRunTab: (AgentType) -> Void
    var onRunTabWithOptions: (AgentType) -> Void
}

// MARK: - Request types (5F)

/// Pending request to show the flow-input collection dialog before starting a flow.
/// Set by `RunMenuViewModel.callbacks(...)` when a flow has non-empty inputs;
/// consumed and cleared by `RunMenuViewModel.confirmFlowInput(...)`.
struct FlowInputRequest: Equatable {
    let flowId: String
    let flowName: String
    let inputs: [FlowInputDefinition]
    let taskId: String?
    let projectId: String?
}

/// Pending request to show the agent-options dialog before launching a tab.
/// Set by `RunMenuViewModel.callbacks(...)` `onRunTabWithOptions`;
/// consumed and cleared by `RunMenuViewModel.confirmRunOptions(...)`.
struct RunOptionsRequest: Equatable {
    let agent: AgentType
    let title: String
    let taskId: String?
    let projectId: String?
}

// MARK: - RunMenuViewModel

/// Ports `hooks/useRunMenu.ts` + `lib/run-menu.ts`.
///
/// Responsibilities:
/// - Lazily fetches `scripts:list` and `agent-commands:list` per project (mirrors the
///   `useEffect` that fires when `enabled` becomes true in `useRunMenu.ts`).
/// - Assembles `RunMenuData` from its own caches + `FlowViewModel` data passed in at call site.
/// - Provides the `hasRunMenuItems` predicate (static, nonisolated, TDD'd).
/// - Builds `RunMenuCallbacks` with launch actions closed over injected VMs.
///
/// **Availability seam:** 5B treats every agent as installed. The TS `useAgentAvailability`
/// hook + `isAgentAvailable` gate are replaced with an always-true assumption, gated only on
/// WS-connected (`online`) in the UI layer (not in `hasRunMenuItems`).
///
/// **No AppEnvironment back-reference:** VMs are injected at call site (Task 9) to avoid
/// a reference cycle.
@MainActor
@Observable
final class RunMenuViewModel {

    // MARK: - Agent constants
    // Ports ALL_AGENT_TYPES + AGENT_DISPLAY_NAMES from packages/shared/src/types/agent.ts.

    nonisolated static let allAgentTypes: [AgentType] = [.claude, .codex, .opencode, .gemini, .cursor, .pi]

    nonisolated static func displayName(_ agent: AgentType) -> String {
        switch agent {
        case .claude:   return "Claude"
        case .codex:    return "Codex"
        case .opencode: return "OpenCode"
        case .gemini:   return "Gemini"
        case .cursor:   return "Cursor"
        case .pi:       return "Pi"
        }
    }

    // MARK: - State

    @ObservationIgnored private let client: WSClient
    /// Fetched scripts keyed by projectId. Populated by `ensureLoaded`.
    private var scriptsByProject: [String: [String: String]] = [:]
    /// Fetched agent commands keyed by projectId. Populated by `ensureLoaded`.
    private var agentCommandsByProject: [String: [AgentCommand]] = [:]

    /// Non-nil when the flow-input dialog should be presented. Set by `onStartFlow` when
    /// the selected flow has non-empty inputs; cleared by `confirmFlowInput`.
    var flowInputRequest: FlowInputRequest?

    /// Non-nil when the agent-options dialog should be presented. Set by `onRunTabWithOptions`;
    /// cleared by `confirmRunOptions`.
    var runOptionsRequest: RunOptionsRequest?

    // MARK: - Init

    init(client: WSClient) {
        self.client = client
    }

    // MARK: - Lazy fetch

    /// Fetches `scripts:list` and `agent-commands:list` for the given project, caching results.
    ///
    /// Mirrors the `useEffect` in `useRunMenu.ts` that fires when `enabled` (context-menu open)
    /// becomes true. Results are cached per `projectId`; subsequent calls are no-ops.
    /// Errors are swallowed silently (matching the TS `.catch(() => setScripts(emptyScripts))`
    /// fallback — a missing `package.json` or no `.claude` dir is not an error for the UI).
    func ensureLoaded(projectId: String, projectPath: String) async {
        if scriptsByProject[projectId] == nil {
            if let resp: ScriptsListResponse = try? await client.request(
                .scriptsList, payload: ["path": projectPath]
            ) {
                scriptsByProject[projectId] = resp.scripts
            } else {
                scriptsByProject[projectId] = [:]
            }
        }
        if agentCommandsByProject[projectId] == nil {
            if let resp: AgentCommandsListResponse = try? await client.request(
                .agentCommandsList, payload: ["path": projectPath]
            ) {
                agentCommandsByProject[projectId] = resp.commands
            } else {
                agentCommandsByProject[projectId] = []
            }
        }
    }

    func resolveTerminalShell(configuredShell: String) async -> String? {
        guard let resp: ShellListResponse = try? await client.request(.shellsList, payload: [:]) else {
            return nil
        }
        return Self.resolveTerminalShellPath(
            shells: resp.shells,
            systemShellPath: resp.systemShellPath,
            configuredShell: configuredShell
        )
    }

    nonisolated static func resolveTerminalShellPath(
        shells: [ShellInfo],
        systemShellPath: String?,
        configuredShell: String
    ) -> String? {
        if configuredShell != "system", shells.contains(where: { $0.path == configuredShell }) {
            return configuredShell
        }
        if let systemShellPath, shells.contains(where: { $0.path == systemShellPath }) {
            return systemShellPath
        }
        return shells.first?.path ?? systemShellPath
    }

    // MARK: - Data assembly

    /// Assembles the `RunMenuData` bag for the given context.
    ///
    /// `flows`, `standaloneActions`, `hasActiveFlowRun`, `defaultRuntime`, `online`, and
    /// `showAgentOptions` are passed in from the call site (Task 9) — this VM does NOT hold
    /// live references to `FlowViewModel` or `SettingsViewModel`.
    func data(
        projectId: String,
        flows: [FlowDefinition],
        standaloneActions: [ActionDefinition],
        hasActiveFlowRun: Bool,
        defaultRuntime: String,
        online: Bool,
        showAgentOptions: Bool
    ) -> RunMenuData {
        RunMenuData(
            scripts: scriptsByProject[projectId] ?? [:],
            defaultRuntime: defaultRuntime,
            agentCommands: agentCommandsByProject[projectId] ?? [],
            flows: flows,
            standaloneActions: standaloneActions,
            hasActiveFlowRun: hasActiveFlowRun,
            showAgentOptions: showAgentOptions,
            online: online
        )
    }

    // MARK: - Predicate

    /// Ports `hasRunMenuItems` from `packages/ui/src/lib/run-menu.ts`.
    ///
    /// 5B simplification: `agentCommands` is gated on non-empty only (all agents treated as
    /// available). The TS gates on `hasClaudeAgent = isAgentAvailable(data.agents, "claude")`;
    /// in 5B that always evaluates to `true` — the gate becomes `!d.agentCommands.isEmpty`.
    ///
    /// `online` is NOT checked in this predicate (mirrors TS — online governs item enablement,
    /// not existence).
    nonisolated static func hasRunMenuItems(_ d: RunMenuData) -> Bool {
        !d.scripts.isEmpty
            || !d.agentCommands.isEmpty                  // 5B: all-available; TS also checks hasClaudeAgent
            || (!d.flows.isEmpty && !d.hasActiveFlowRun)
            || !d.standaloneActions.isEmpty
            || d.showAgentOptions
    }

    // MARK: - Callbacks factory

    /// Builds `RunMenuCallbacks` for the given project/task context.
    ///
    /// **Signature note:** `defaultRuntime` is an explicit parameter because the TS reads it
    /// from `useSettingsStore`. The call site (Task 9) supplies
    /// `env.settings?.settings?.general.defaultRuntime ?? "bun"`.
    ///
    /// VMs (`session`, `flows`, `tasks`) are injected here (not captured from AppEnvironment)
    /// so `RunMenuViewModel` carries no back-reference to the environment.
    ///
    /// **Navigation:** ports the `navigate(focusWorkspace:)` helper in `useRunMenu.ts`:
    ///   `setActiveTask` → `setActiveProject` → `setFocusedPanel(.workspace)`.
    ///   `setMasterWorkspaceActive(false)` is NOT called — the TS `navigate` does not call it.
    ///
    /// **Prompt delivery:** agent sessions pass `prompt` to the backend so startup arguments/env
    /// are assembled consistently with the web app. Shell sessions still send commands after
    /// creation, matching `runInShell`.
    func callbacks(
        projectId: String,
        taskId: String?,
        session: SessionViewModel?,
        flows: FlowViewModel?,
        tasks: TaskViewModel?,
        ui: UIViewModel,
        defaultRuntime: String,
        configuredShell: String
    ) -> RunMenuCallbacks {

        // Workspace key used as `targetWorkspaceKey` so the new tab lands in the right pane.
        let workspaceKey: String = taskId.map(WorkspaceKey.task) ?? WorkspaceKey.project(projectId)

        // MARK: onRunScript
        // TS: navigate(true) → runInShell({ command: `${defaultRuntime} run ${name}\r` })
        let onRunScript: (String) -> Void = { name in
            Task { @MainActor in
                if let tid = taskId { tasks?.setActiveTask(tid) }
                ui.setActiveProject(projectId)
                ui.setFocusedPanel(.workspace)
                do {
                    guard let session else { return }
                    guard let shell = await self.resolveTerminalShell(configuredShell: configuredShell) else {
                        return
                    }
                    let sid = try await session.createSession(
                        taskId: taskId,
                        projectId: taskId == nil ? projectId : nil,
                        type: .shell,
                        label: name,
                        shell: shell,
                        targetWorkspaceKey: workspaceKey
                    )
                    session.sendInput(sessionId: sid, data: "\(defaultRuntime) run \(name)\r")
                } catch {}
            }
        }

        // MARK: onRunAgentCommand
        // TS: navigate(true) → createSession(owner, "claude", cmd.name, `/${cmd.name}`)
        let onRunAgentCommand: (AgentCommand) -> Void = { cmd in
            Task { @MainActor in
                if let tid = taskId { tasks?.setActiveTask(tid) }
                ui.setActiveProject(projectId)
                ui.setFocusedPanel(.workspace)
                do {
                    guard let session else { return }
                    _ = try await session.createSession(
                        taskId: taskId,
                        projectId: taskId == nil ? projectId : nil,
                        type: .claude,
                        label: cmd.name,
                        prompt: "/\(cmd.name)",
                        targetWorkspaceKey: workspaceKey
                    )
                } catch {}
            }
        }

        // MARK: onStartFlow
        // TS: if flow.inputs non-empty → setFlowInputState (dialog seam); else navigate + startFlow
        let onStartFlow: (String) -> Void = { [weak self] flowId in
            Task { @MainActor [weak self] in
                guard let self else { return }
                let flow = flows?.flows.first { $0.id == flowId }
                if let flow, let inputs = flow.inputs, !inputs.isEmpty {
                    // 5F: flow-input dialog seam — collect inputs before starting
                    self.flowInputRequest = FlowInputRequest(
                        flowId: flowId,
                        flowName: flow.name,
                        inputs: inputs,
                        taskId: taskId,
                        projectId: taskId == nil ? projectId : nil
                    )
                    return
                }
                if let tid = taskId { tasks?.setActiveTask(tid) }
                ui.setActiveProject(projectId)
                ui.setFocusedPanel(.workspace)
                let params = FlowStartPayload(
                    taskId: taskId,
                    projectId: taskId == nil ? projectId : nil,
                    master: nil,
                    flowId: flowId,
                    inputValues: nil
                )
                _ = try? await flows?.startFlow(params)
            }
        }

        // MARK: onRunAction
        // TS: navigate(true) → if shell → runInShell(prompt); else createSession(sessionType, prompt)
        // Swift: agents pass prompt into createSession; shell actions send command after creation.
        let onRunAction: (ActionDefinition) -> Void = { action in
            Task { @MainActor in
                if let tid = taskId { tasks?.setActiveTask(tid) }
                ui.setActiveProject(projectId)
                ui.setFocusedPanel(.workspace)
                do {
                    guard let session else { return }
                    // SessionType.shell → TabType.shell; other SessionTypes map 1:1 to TabType raw values.
                    let tabType: TabType = action.sessionType == .shell
                        ? .shell
                        : TabType(rawValue: action.sessionType.rawValue) ?? .shell
                    let shell = tabType == .shell
                        ? await self.resolveTerminalShell(configuredShell: configuredShell)
                        : nil
                    if tabType == .shell && shell == nil { return }
                    let sid = try await session.createSession(
                        taskId: taskId,
                        projectId: taskId == nil ? projectId : nil,
                        type: tabType,
                        label: action.name,
                        prompt: tabType == .shell ? nil : (action.prompt.isEmpty ? nil : action.prompt),
                        shell: shell,
                        targetWorkspaceKey: workspaceKey
                    )
                    if tabType == .shell && !action.prompt.isEmpty {
                        session.sendInput(sessionId: sid, data: "\(action.prompt)\r")
                    }
                } catch {}
            }
        }

        // MARK: onRunTab
        // TS: if !taskId → return; navigate → createSession(type, prompt: task.description)
        // Swift: guard taskId → navigate → createSession(prompt: task.description)
        let onRunTab: (AgentType) -> Void = { agent in
            guard let taskId else { return }
            Task { @MainActor in
                tasks?.setActiveTask(taskId)
                ui.setActiveProject(projectId)
                ui.setFocusedPanel(.workspace)
                do {
                    guard let session else { return }
                    let tabType = TabType(rawValue: agent.rawValue) ?? .shell
                    let description = tasks?.tasks.first { $0.id == taskId }?.description
                    _ = try await session.createSession(
                        taskId: taskId,
                        type: tabType,
                        prompt: (description?.isEmpty == false) ? description : nil,
                        targetWorkspaceKey: WorkspaceKey.task(taskId)
                    )
                } catch {}
            }
        }

        // MARK: onRunTabWithOptions
        // 5F: AgentOptionsDialog seam — present agent options UI before launching.
        // Phase 5F wires a dialog that collects AgentLaunchOptions, then calls confirmRunOptions.
        let onRunTabWithOptions: (AgentType) -> Void = { [weak self] agent in
            guard let self else { return }
            self.runOptionsRequest = RunOptionsRequest(
                agent: agent,
                title: "Run \(RunMenuViewModel.displayName(agent)) with options",
                taskId: taskId,
                projectId: taskId == nil ? projectId : nil
            )
        }

        return RunMenuCallbacks(
            onRunScript: onRunScript,
            onRunAgentCommand: onRunAgentCommand,
            onStartFlow: onStartFlow,
            onRunAction: onRunAction,
            onRunTab: onRunTab,
            onRunTabWithOptions: onRunTabWithOptions
        )
    }

    // MARK: - Confirm methods (5F)

    /// Called by FlowInputDialog when the user confirms input values.
    /// Navigates to the appropriate context and starts the flow with the collected values,
    /// then clears `flowInputRequest`.
    func confirmFlowInput(
        _ values: [String: String],
        flows: FlowViewModel?,
        tasks: TaskViewModel?,
        ui: UIViewModel
    ) {
        guard let req = flowInputRequest else { return }
        if let tid = req.taskId { tasks?.setActiveTask(tid) }
        if let pid = req.projectId { ui.setActiveProject(pid) }
        ui.setFocusedPanel(.workspace)
        let params = FlowStartPayload(
            taskId: req.taskId,
            projectId: req.projectId,
            master: nil,
            flowId: req.flowId,
            inputValues: values
        )
        Task { @MainActor in try? await flows?.startFlow(params) }
        flowInputRequest = nil
    }

    /// Called by AgentOptionsDialog when the user confirms launch options.
    /// Navigates to the task context and creates an agent session,
    /// then clears `runOptionsRequest`.
    ///
    func confirmRunOptions(
        _ options: AgentLaunchOptions,
        session: SessionViewModel?,
        tasks: TaskViewModel?,
        ui: UIViewModel
    ) {
        guard let req = runOptionsRequest else { return }
        guard let taskId = req.taskId else { runOptionsRequest = nil; return }
        tasks?.setActiveTask(taskId)
        if let pid = req.projectId { ui.setActiveProject(pid) }
        ui.setFocusedPanel(.workspace)
        let tabType = TabType(rawValue: req.agent.rawValue) ?? .shell
        let description = tasks?.tasks.first { $0.id == taskId }?.description
        runOptionsRequest = nil
        guard let session else { return }
        Task { @MainActor in
            do {
                _ = try await session.createSession(
                    taskId: taskId,
                    type: tabType,
                    prompt: (description?.isEmpty == false) ? description : nil,
                    targetWorkspaceKey: WorkspaceKey.task(taskId),
                    agentOptions: options
                )
            } catch {}
        }
    }
}
