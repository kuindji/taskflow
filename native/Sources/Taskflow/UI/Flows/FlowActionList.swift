import SwiftUI

/// Ordered list of a flow's action entries with up/down reorder (button-based, no drag-and-drop),
/// remove, and two add affordances ("From Library" menu + "Inline Action" button).
/// Embeds `InlineActionEditor` for inline entries.
/// Port of `packages/ui/src/components/flows/FlowActionList.tsx`.
struct FlowActionList: View {

    // MARK: - Props

    @Binding var entries: [FlowActionEntryKind]
    let globalActions: [ActionDefinition]
    let libraryActions: [ActionDefinition]

    // MARK: - Environment

    @Environment(\.appTheme) private var theme

    // MARK: - Body

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            topControls
            entryList
        }
    }

    // MARK: - Sub-views

    private var topControls: some View {
        HStack(spacing: 4) {
            if !libraryActions.isEmpty {
                AppMenu(title: "+ From Library") {
                    ForEach(libraryActions, id: \.id) { action in
                        Button(action.name) {
                            entries.append(.reference(FlowActionReferenceEntry(
                                id: UUID().uuidString,
                                label: nil,
                                actionId: action.id
                            )))
                        }
                    }
                }
            }
            AppButton(title: "+ Inline Action", kind: .secondary) {
                entries.append(.inline(FlowActionInlineEntry(
                    id: UUID().uuidString,
                    label: nil,
                    inline: ActionInline(
                        name: "",
                        prompt: "",
                        sessionType: .claude,
                        agentOptions: nil
                    )
                )))
            }
        }
        .frame(maxWidth: .infinity, alignment: .trailing)
    }

    @ViewBuilder
    private var entryList: some View {
        if entries.isEmpty {
            Text("No actions added yet")
                .font(.system(size: 14))
                .foregroundStyle(theme.foreground.opacity(0.5))
                .frame(maxWidth: .infinity, alignment: .center)
                .padding(.vertical, 24)
                .overlay(
                    RoundedRectangle(cornerRadius: 6)
                        .stroke(theme.border.opacity(0.5), style: StrokeStyle(lineWidth: 1, dash: [5]))
                )
        } else {
            VStack(spacing: 8) {
                ForEach(Array(entries.enumerated()), id: \.element.id) { index, entry in
                    entryRow(index: index, entry: entry)
                }
            }
        }
    }

    private func entryRow(index: Int, entry: FlowActionEntryKind) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 8) {
                // Up / Down reorder buttons
                VStack(spacing: 2) {
                    Button {
                        guard index > 0 else { return }
                        entries.swapAt(index, index - 1)
                    } label: {
                        AppIcon("ChevronUp").font(.system(size: 9))
                    }
                    .buttonStyle(.plain)
                    .disabled(index == 0)

                    Button {
                        guard index < entries.count - 1 else { return }
                        entries.swapAt(index, index + 1)
                    } label: {
                        AppIcon("ChevronDown").font(.system(size: 9))
                    }
                    .buttonStyle(.plain)
                    .disabled(index == entries.count - 1)
                }

                // Index label
                Text("\(index + 1).")
                    .font(.system(size: 12, weight: .medium))
                    .foregroundStyle(theme.foreground.opacity(0.6))
                    .monospacedDigit()

                // Action name
                Text(Self.getActionName(entry, globalActions: globalActions))
                    .font(.system(size: 14, weight: .medium))
                    .frame(maxWidth: .infinity, alignment: .leading)

                // Session-type badge
                AppBadge(text: Self.getActionType(entry, globalActions: globalActions))

                // Remove button
                Button {
                    entries.remove(at: index)
                } label: {
                    AppIcon("X").font(.system(size: 10))
                }
                .buttonStyle(.plain)
            }

            // Inline editor (only for inline entries)
            if case .inline(let i) = entry {
                InlineActionEditor(
                    entryId: i.id,
                    inline: i.inline,
                    onUpdate: { id, newInline in
                        if let idx = entries.firstIndex(where: { $0.id == id }) {
                            entries[idx] = .inline(FlowActionInlineEntry(
                                id: id,
                                label: i.label,
                                inline: newInline
                            ))
                        }
                    }
                )
            }
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

    /// Returns a display name for the given entry.
    /// Mirrors `getActionName` in `packages/ui/src/components/flows/FlowActionList.tsx`.
    nonisolated static func getActionName(
        _ entry: FlowActionEntryKind,
        globalActions: [ActionDefinition]
    ) -> String {
        switch entry {
        case .reference(let r):
            if let label = r.label, !label.isEmpty { return label }
            return globalActions.first { $0.id == r.actionId }?.name ?? "Unknown action"
        case .inline(let i):
            if let label = i.label, !label.isEmpty { return label }
            return i.inline.name.isEmpty ? "Unknown action" : i.inline.name
        }
    }

    /// Returns the session-type string for the given entry.
    /// Mirrors `getActionType` in `packages/ui/src/components/flows/FlowActionList.tsx`.
    nonisolated static func getActionType(
        _ entry: FlowActionEntryKind,
        globalActions: [ActionDefinition]
    ) -> String {
        switch entry {
        case .reference(let r):
            return globalActions.first { $0.id == r.actionId }?.sessionType.rawValue ?? "?"
        case .inline(let i):
            return i.inline.sessionType.rawValue
        }
    }
}
