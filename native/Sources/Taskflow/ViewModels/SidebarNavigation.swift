import Foundation

/// Direction for sidebar keyboard navigation.
enum NavDirection { case up, down }

/// Pure next-focus reducer for sidebar keyboard navigation.
///
/// Port of `useSidebarNavigation.ts` ordering:
/// - Flattened list = each visible project followed by its top-level tasks
///   (tasks of collapsed projects are omitted — only the project row appears).
/// - Behaviour at ends: CLAMP (matches TS: `if nextIdx < 0 || nextIdx >= length { return }`).
/// - `current == nil` → first item for `.down`, last for `.up` (mirrors TS nil-path).
/// - `current` not found in list → same nil-fallback (stale reference treated as no selection).
enum SidebarNavigation {
    nonisolated static func next(
        items: [SidebarFocusedItem],
        current: SidebarFocusedItem?,
        direction: NavDirection
    ) -> SidebarFocusedItem? {
        guard !items.isEmpty else { return nil }
        guard let current, let idx = items.firstIndex(of: current) else {
            return direction == .down ? items.first : items.last
        }
        switch direction {
        case .down: return items[min(idx + 1, items.count - 1)]
        case .up:   return items[max(idx - 1, 0)]
        }
    }
}
