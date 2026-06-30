import SwiftUI

/// Single mount point for all app-level singleton dialogs (command palette, shortcuts, task/project
/// creation, missing-location, fork, flow-input, run-with-options). Mounted once in `AppShell`.
/// Mirrors the centralized dialog mounting in `packages/ui/src/App.tsx`.
struct GlobalDialogHost: View {
    @Environment(AppEnvironment.self) private var env

    // MARK: - Project dialog state

    @State private var projectError: String? = nil
    /// Raised when a new-task request arrives with no projects; causes the project dialog to
    /// open first so a project is created before the task dialog is shown.
    @State private var openTaskAfterProject: Bool = false

    // MARK: - Task dialog state

    @State private var showNewTask: Bool = false
    /// Captured `defaultProjectId` for the task dialog; computed when the sheet is requested so
    /// it survives a later `clear()` call that zeroes out `newTaskRequest`.
    @State private var taskDefaultProjectId: String? = nil
    /// Captured `parentId` for the task dialog (nil when it is a top-level task).
    @State private var taskParentId: String? = nil

    // MARK: - Deferred-start state

    /// Held while waiting for the worktree path to appear in the task list.
    /// Set when the user requests a new worktree task with a start-with agent/flow.
    @State private var pendingStart: PendingStart? = nil

    private struct PendingStart: Equatable {
        let taskId: String
        let submit: NewTaskSubmit
    }

    // MARK: - Body

    var body: some View {
        // Zero-size anchor that only carries sheet modifiers.
        Color.clear.frame(width: 0, height: 0)
            .sheet(isPresented: Binding(
                get: { env.ui.commandPaletteOpen },
                set: { if !$0 { env.ui.setCommandPaletteOpen(false) } }
            )) { CommandPaletteDialog() }
            .sheet(isPresented: Binding(
                get: { env.ui.shortcutsDialogOpen },
                set: { if !$0 { env.ui.setShortcutsDialogOpen(false) } }
            )) { KeyboardShortcutsDialog() }
            // ── New Project sheet ──────────────────────────────────────────────────────────
            // When chaining (openTaskAfterProject == true), skip full clear() — the task dialog's
            // dismiss handler will call it instead. This avoids wiping newTaskRequest early while
            // taskDefaultProjectId/taskParentId are still needed.
            .sheet(isPresented: Binding(
                get: { env.taskCreation.newProjectRequested },
                set: { newValue in
                    if !newValue {
                        projectError = nil
                        if !showNewTask {
                            openTaskAfterProject = false
                            env.taskCreation.clear()
                        }
                    }
                }
            )) {
                NewProjectDialog(
                    isPresented: Binding(
                        get: { env.taskCreation.newProjectRequested },
                        set: { if !$0 { env.taskCreation.newProjectRequested = false } }
                    ),
                    error: projectError,
                    onSubmit: handleProjectSubmit
                )
            }
            // ── New Task sheet ─────────────────────────────────────────────────────────────
            .sheet(isPresented: Binding(
                get: { showNewTask },
                set: { newValue in
                    if !newValue {
                        showNewTask = false
                        openTaskAfterProject = false
                        env.taskCreation.clear()
                    }
                }
            )) {
                NewTaskDialog(
                    isPresented: Binding(
                        get: { showNewTask },
                        set: { if !$0 { showNewTask = false } }
                    ),
                    projects: env.projects?.projects ?? [],
                    flows: env.flows?.flows ?? [],
                    defaultProjectId: taskDefaultProjectId,
                    parentId: taskParentId,
                    onSubmit: handleTaskSubmit
                )
            }
            // ── No-projects coordination ───────────────────────────────────────────────────
            // Ports the guard in requestNewTask (task-creation-store.ts): when there are no
            // projects and the request is not a subtask, open the project dialog first so the
            // user creates a project; then chain to the task dialog on success.
            .onChange(of: env.taskCreation.newTaskRequest) { _, request in
                guard let request else { return }
                let isSubtask = request.parentId != nil
                let hasProjects = !(env.projects?.projects.isEmpty ?? true)
                if !isSubtask && !hasProjects {
                    taskParentId = nil
                    taskDefaultProjectId = nil
                    openTaskAfterProject = true
                    env.taskCreation.newProjectRequested = true
                } else {
                    taskParentId = request.parentId
                    taskDefaultProjectId = computeDefaultProjectId(request: request)
                    showNewTask = true
                }
            }
            // ── Flow-input sheet ───────────────────────────────────────────────────────────
            .sheet(isPresented: Binding(
                get: { env.runMenu?.flowInputRequest != nil },
                set: { if !$0 { env.runMenu?.flowInputRequest = nil } }
            )) {
                if let req = env.runMenu?.flowInputRequest {
                    FlowInputDialog(
                        isPresented: Binding(
                            get: { env.runMenu?.flowInputRequest != nil },
                            set: { if !$0 { env.runMenu?.flowInputRequest = nil } }
                        ),
                        request: req,
                        onSubmit: { values in
                            env.runMenu?.confirmFlowInput(
                                values,
                                flows: env.flows,
                                tasks: env.tasks,
                                ui: env.ui
                            )
                        },
                        onCancel: { env.runMenu?.flowInputRequest = nil }
                    )
                }
            }
            // ── Agent-options sheet ────────────────────────────────────────────────────────
            .sheet(isPresented: Binding(
                get: { env.runMenu?.runOptionsRequest != nil },
                set: { if !$0 { env.runMenu?.runOptionsRequest = nil } }
            )) {
                if let req = env.runMenu?.runOptionsRequest {
                    AgentOptionsDialog(
                        isPresented: Binding(
                            get: { env.runMenu?.runOptionsRequest != nil },
                            set: { if !$0 { env.runMenu?.runOptionsRequest = nil } }
                        ),
                        request: req,
                        onRun: { opts in
                            env.runMenu?.confirmRunOptions(
                                opts,
                                session: env.session,
                                tasks: env.tasks,
                                ui: env.ui
                            )
                        },
                        onCancel: { env.runMenu?.runOptionsRequest = nil }
                    )
                }
            }
            // ── Deferred-start watcher ─────────────────────────────────────────────────────
            // Ports the pendingSessionRef / useEffect (TaskCreationDialogHost.tsx, lines 53-84):
            // watches for the worktree path to become non-empty, then fires startNow and clears.
            .onChange(of: env.tasks?.tasks ?? []) { _, tasks in
                guard let p = pendingStart,
                      let t = tasks.first(where: { $0.id == p.taskId }),
                      t.worktree.enabled,
                      let path = t.worktree.path, !path.isEmpty else { return }
                pendingStart = nil
                startNow(taskId: p.taskId, submit: p.submit)
            }
    }

    // MARK: - Helpers

    /// Computes the defaultProjectId using the same priority chain as the TS hook:
    /// request.projectId → active task's project → ui.activeProjectId → projects.first.
    private func computeDefaultProjectId(
        request: TaskCreationViewModel.NewTaskRequest
    ) -> String? {
        if let id = request.projectId { return id }
        if let activeTaskId = env.tasks?.activeTaskId,
           let activeTask = env.tasks?.tasks.first(where: { $0.id == activeTaskId }) {
            return activeTask.projectId
        }
        if let id = env.ui.activeProjectId { return id }
        return env.projects?.projects.first?.id
    }

    // MARK: - Submit handlers

    private func handleProjectSubmit(_ path: String) {
        Task { @MainActor in
            do {
                let created = try await env.projects?.addProject(path: path)
                projectError = nil
                if openTaskAfterProject {
                    // Chain to task dialog; use the newly created project as the default.
                    taskDefaultProjectId = created?.id ?? env.projects?.projects.first?.id
                    taskParentId = nil
                    showNewTask = true
                    openTaskAfterProject = false
                    env.taskCreation.newProjectRequested = false
                    // Do NOT call clear() — the task dialog's dismiss binding calls it.
                } else {
                    env.taskCreation.clear()
                }
            } catch {
                projectError = error.localizedDescription
            }
        }
    }

    private func handleTaskSubmit(_ s: NewTaskSubmit) {
        Task { @MainActor in
            do {
                let created = try await env.tasks?.createTask(
                    projectId: s.projectId,
                    title: s.title,
                    description: s.description,
                    worktree: s.worktree,
                    parentId: s.parentId,
                    initCommand: (s.initCommand?.isEmpty == true) ? nil : s.initCommand
                )
                guard let created else {
                    showNewTask = false
                    env.taskCreation.clear()
                    return
                }
                env.ui.setActiveProject(created.projectId)
                env.tasks?.setActiveTask(created.id)
                env.ui.setFocusedPanel(.workspace)
                if s.startWith != nil || s.startWithFlowId != nil {
                    if s.worktree && s.parentId == nil {
                        // Worktree path not ready at create time — defer until path appears.
                        pendingStart = PendingStart(taskId: created.id, submit: s)
                    } else {
                        startNow(taskId: created.id, submit: s)
                    }
                }
                showNewTask = false
                env.taskCreation.clear()
            } catch {
                // Surface minimally: the dialog closes and we clear state.
                showNewTask = false
                env.taskCreation.clear()
            }
        }
    }

    // MARK: - Agent/flow start

    /// Starts an agent session or flow for `taskId` immediately.
    /// Called either inline (no worktree / subtask) or deferred (worktree path is now ready).
    private func startNow(taskId: String, submit: NewTaskSubmit) {
        if let flowId = submit.startWithFlowId {
            Task { @MainActor in
                try? await env.flows?.startFlow(
                    FlowStartPayload(
                        taskId: taskId,
                        projectId: nil,
                        master: nil,
                        flowId: flowId,
                        inputValues: nil
                    )
                )
            }
        } else if let agent = submit.startWith {
            Task { @MainActor in
                try? await env.session?.createSession(
                    taskId: taskId,
                    type: TabType(rawValue: agent.rawValue) ?? .shell,
                    label: nil,
                    targetWorkspaceKey: WorkspaceKey.task(taskId),
                    agentOptions: submit.agentOptions
                )
            }
        }
    }
}
