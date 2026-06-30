import SwiftUI

/// Create/edit form for a `FlowDefinition`: name, description, project, inputs, and ordered action list.
/// Port of `packages/ui/src/components/flows/FlowEditor.tsx`.
struct FlowEditor: View {

    // MARK: - Props

    let flow: FlowDefinition?
    let globalActions: [ActionDefinition]
    var defaultProjectId: String?
    let onSave: (FlowDefinition) -> Void
    let onCancel: () -> Void
    var onDelete: (() -> Void)?

    // MARK: - Environment

    @Environment(AppEnvironment.self) private var env
    @Environment(\.appTheme) private var theme

    // MARK: - State

    @State private var name: String
    @State private var description: String
    @State private var projectId: String?
    @State private var entries: [FlowActionEntryKind]
    @State private var inputs: [FlowInputDefinition]
    @State private var confirmDelete: Bool = false

    // Baseline snapshot for dirty-checking — fixed at creation time.
    private let initialKey: String

    // MARK: - Init

    init(
        flow: FlowDefinition?,
        globalActions: [ActionDefinition],
        defaultProjectId: String? = nil,
        onSave: @escaping (FlowDefinition) -> Void,
        onCancel: @escaping () -> Void,
        onDelete: (() -> Void)? = nil
    ) {
        self.flow = flow
        self.globalActions = globalActions
        self.defaultProjectId = defaultProjectId
        self.onSave = onSave
        self.onCancel = onCancel
        self.onDelete = onDelete

        let initialName        = flow?.name ?? ""
        let initialDescription = flow?.description ?? ""
        let initialProjectId   = flow?.projectId ?? defaultProjectId
        let initialEntries     = FlowActionEntryCodec.decode(flow?.actions ?? [])
        let initialInputs      = flow?.inputs ?? []

        _name        = State(initialValue: initialName)
        _description = State(initialValue: initialDescription)
        _projectId   = State(initialValue: initialProjectId)
        _entries     = State(initialValue: initialEntries)
        _inputs      = State(initialValue: initialInputs)

        // Build the baseline key using the exact same transform as currentKey.
        // Both sides decode → normalizeInline → encode so an unedited existing
        // flow always produces hasChanges == false.
        initialKey = FlowEditor.snapshotKey(
            name: initialName,
            description: initialDescription,
            projectId: initialProjectId,
            entries: initialEntries,
            inputs: initialInputs
        )
    }

    // MARK: - Derived

    /// Actions available in "From Library": global ones (nil projectId) plus any
    /// scoped to the currently selected project. Mirrors the `libraryActions` memo
    /// in FlowEditor.tsx.
    private var libraryActions: [ActionDefinition] {
        globalActions.filter { $0.projectId == nil || $0.projectId == projectId }
    }

    private var isValid: Bool {
        guard !name.trimmingCharacters(in: .whitespaces).isEmpty else { return false }
        guard !entries.isEmpty else { return false }

        let allEntriesValid = entries.allSatisfy { entry -> Bool in
            guard case .inline(let e) = entry else { return true }
            let inline = e.inline
            return !inline.name.trimmingCharacters(in: .whitespaces).isEmpty &&
                   !inline.prompt.trimmingCharacters(in: .whitespaces).isEmpty &&
                   (inline.sessionType == .shell ||
                    AgentOptionsNormalize.normalized(
                        type: inline.sessionType,
                        options: inline.agentOptions
                    ) != nil)
        }
        guard allEntriesValid else { return false }

        let idPattern = "^[a-zA-Z0-9_-]+$"
        let allInputsValid = inputs.allSatisfy { input in
            !input.id.isEmpty &&
            input.id.range(of: idPattern, options: .regularExpression) != nil &&
            !input.label.isEmpty
        }
        guard allInputsValid else { return false }

        return Set(inputs.map { $0.id }).count == inputs.count
    }

    private var currentKey: String {
        FlowEditor.snapshotKey(
            name: name,
            description: description,
            projectId: projectId,
            entries: entries,
            inputs: inputs
        )
    }

    private var hasChanges: Bool { currentKey != initialKey }

    /// Binding bridge: maps `nil` projectId ↔ `"__global__"` sentinel for AppSelect.
    /// Mirrors the bridge in `ActionEditor.swift`.
    private var projectIdSentinel: Binding<String> {
        Binding(
            get: { projectId ?? "__global__" },
            set: { projectId = $0 == "__global__" ? nil : $0 }
        )
    }

    // MARK: - Body

    var body: some View {
        VStack(spacing: 0) {
            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    // Header title
                    Text(headerTitle)
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundStyle(theme.foreground)
                        .padding(.bottom, 20)

                    VStack(alignment: .leading, spacing: 16) {
                        fieldGroup(label: "Name") {
                            AppTextField(text: $name, placeholder: "e.g., Feature Development")
                        }

                        fieldGroup(label: "Description") {
                            AppTextField(text: $description, placeholder: "Full feature lifecycle...")
                        }

                        fieldGroup(label: "Project") {
                            AppSelect(projectIdSentinel, options: projectOptions)
                        }

                        inputsSection

                        fieldGroup(label: "Actions") {
                            FlowActionList(
                                entries: $entries,
                                globalActions: globalActions,
                                libraryActions: libraryActions
                            )
                        }
                    }
                }
                .padding(20)
            }

            Divider()

            // Sticky footer
            HStack(spacing: 8) {
                if flow != nil, onDelete != nil {
                    AppButton(title: "Delete Flow", kind: .destructive) {
                        confirmDelete = true
                    }
                }

                Spacer()

                AppButton(title: "Cancel", kind: .secondary, action: onCancel)

                AppButton(
                    title: flow == nil ? "Create Flow" : "Save Flow",
                    action: save
                )
                .disabled(!isValid || !hasChanges)
            }
            .padding(.horizontal, 20)
            .padding(.vertical, 12)
        }
        .background(theme.background)
        .alert("Delete this flow?", isPresented: $confirmDelete) {
            Button("Delete", role: .destructive) { onDelete?() }
            Button("Cancel", role: .cancel) { }
        }
    }

    // MARK: - Sub-views

    @ViewBuilder
    private func fieldGroup<Content: View>(
        label: String,
        @ViewBuilder content: () -> Content
    ) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(label)
                .font(.system(size: 11, weight: .medium))
                .foregroundStyle(theme.foreground.opacity(0.6))
                .textCase(.uppercase)
                .tracking(0.5)
            content()
        }
    }

    private var inputsSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text("Inputs")
                    .font(.system(size: 11, weight: .medium))
                    .foregroundStyle(theme.foreground.opacity(0.6))
                    .textCase(.uppercase)
                    .tracking(0.5)
                Spacer()
                AppButton(title: "+ Add Input", kind: .secondary) {
                    inputs.append(FlowInputDefinition(id: "", label: "", type: "text"))
                }
            }
            if !inputs.isEmpty {
                VStack(spacing: 8) {
                    ForEach(Array(inputs.indices), id: \.self) { index in
                        inputRow(index: index)
                    }
                }
            }
        }
    }

    private func inputRow(index: Int) -> some View {
        let idBinding = Binding<String>(
            get: { inputs[index].id },
            set: { v in inputs[index] = FlowInputDefinition(id: v, label: inputs[index].label, type: inputs[index].type) }
        )
        let typeBinding = Binding<String>(
            get: { inputs[index].type },
            set: { v in inputs[index] = FlowInputDefinition(id: inputs[index].id, label: inputs[index].label, type: v) }
        )
        let labelBinding = Binding<String>(
            get: { inputs[index].label },
            set: { v in inputs[index] = FlowInputDefinition(id: inputs[index].id, label: v, type: inputs[index].type) }
        )
        return HStack(alignment: .top, spacing: 8) {
            VStack(spacing: 6) {
                HStack(spacing: 6) {
                    AppTextField(text: idBinding, placeholder: "Input ID")
                    AppSelect(typeBinding, options: Self.inputTypeOptions)
                }
                AppTextField(text: labelBinding, placeholder: "Display label")
            }
            Button {
                inputs.remove(at: index)
            } label: {
                AppIcon("X").font(.system(size: 10))
            }
            .buttonStyle(.plain)
            .padding(.top, 6)
        }
        .padding(10)
        .background(theme.muted.opacity(0.3))
        .clipShape(RoundedRectangle(cornerRadius: 8))
        .overlay(
            RoundedRectangle(cornerRadius: 8)
                .stroke(theme.border, lineWidth: 1)
        )
    }

    // MARK: - Helpers

    private var headerTitle: String {
        guard let flow else { return "New Flow" }
        return flow.name.isEmpty ? "Edit Flow" : flow.name
    }

    private var projectOptions: [(value: String, label: String)] {
        var opts: [(value: String, label: String)] = [(value: "__global__", label: "Global")]
        opts += (env.projects?.projects ?? []).map { (value: $0.id, label: $0.name) }
        return opts
    }

    nonisolated static let inputTypeOptions: [(value: String, label: String)] = [
        (value: "text",     label: "Text"),
        (value: "filepath", label: "File path"),
    ]

    // MARK: - Save

    private func save() {
        let now = ISO8601DateFormatter().string(from: Date())
        // Trim inline name/prompt; null agentOptions for shell — mirrors TS handleSave.
        let normalizedEntries = entries.map { entry -> FlowActionEntryKind in
            guard case .inline(let e) = entry else { return entry }
            let inline = e.inline
            return .inline(FlowActionInlineEntry(
                id: e.id,
                label: e.label,
                inline: ActionInline(
                    name: inline.name.trimmingCharacters(in: .whitespaces),
                    prompt: inline.prompt.trimmingCharacters(in: .whitespaces),
                    sessionType: inline.sessionType,
                    agentOptions: inline.sessionType == .shell ? nil : inline.agentOptions
                )
            ))
        }
        let definition = FlowDefinition(
            id: flow?.id ?? UUID().uuidString,
            projectId: projectId,
            name: name.trimmingCharacters(in: .whitespaces),
            description: description.trimmingCharacters(in: .whitespaces),
            actions: FlowActionEntryCodec.encode(normalizedEntries),
            inputs: inputs.isEmpty ? nil : inputs,
            createdAt: flow?.createdAt ?? now,
            updatedAt: now
        )
        onSave(definition)
    }

    // MARK: - Snapshot (dirty-check key)

    /// Canonical snapshot string for dirty-checking.
    /// Both `initialKey` (seeded in init) and `currentKey` (computed on each render)
    /// run through this same function, so an unedited existing flow always yields
    /// `hasChanges == false`. Mirrors `initialSnapshot` / `currentSnapshot` in
    /// `packages/ui/src/components/flows/FlowEditor.tsx`.
    nonisolated static func snapshotKey(
        name: String,
        description: String,
        projectId: String?,
        entries: [FlowActionEntryKind],
        inputs: [FlowInputDefinition]
    ) -> String {
        // Apply normalizeAgentOptions to inline entries — matches TS `normalizeActions`.
        let normalizedEntries = entries.map { entry -> FlowActionEntryKind in
            guard case .inline(let e) = entry else { return entry }
            let inline = e.inline
            let opts = AgentOptionsNormalize.normalized(type: inline.sessionType, options: inline.agentOptions)
            return .inline(FlowActionInlineEntry(
                id: e.id,
                label: e.label,
                inline: ActionInline(
                    name: inline.name,
                    prompt: inline.prompt,
                    sessionType: inline.sessionType,
                    agentOptions: opts
                )
            ))
        }
        let encoded = FlowActionEntryCodec.encode(normalizedEntries)
        let enc = JSONEncoder()
        enc.outputFormatting = .sortedKeys
        let actionsJSON = (try? enc.encode(encoded)).flatMap { String(data: $0, encoding: .utf8) } ?? "[]"
        let inputsJSON  = (try? enc.encode(inputs)).flatMap { String(data: $0, encoding: .utf8) } ?? "[]"
        return [
            "name=\(name)",
            "description=\(description)",
            "projectId=\(projectId ?? "__global__")",
            "actions=\(actionsJSON)",
            "inputs=\(inputsJSON)",
        ].joined(separator: "&")
    }
}
