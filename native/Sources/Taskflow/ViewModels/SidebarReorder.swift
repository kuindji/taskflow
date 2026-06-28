import Foundation

/// Pure ordering helpers for sidebar drag-reorder.
/// Ports packages/shared/src/utils/project-order.ts `buildReorderedProjectIds`.
enum SidebarReorder {
    /// Build a full id ordering from a reorder of only the visible subset. Walks `fullIds`;
    /// positions holding a visible id are filled, in order, from `visibleIdsInNewOrder`,
    /// while every other id keeps its absolute position.
    nonisolated static func buildReorderedProjectIds(fullIds: [String], visibleIdsInNewOrder: [String]) -> [String] {
        let visibleSet = Set(visibleIdsInNewOrder)
        var queue = visibleIdsInNewOrder
        return fullIds.map { id in
            guard visibleSet.contains(id) else { return id }
            return queue.isEmpty ? id : queue.removeFirst()
        }
    }
}
