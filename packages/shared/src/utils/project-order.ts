/**
 * Reorder `items` so their order matches `orderedIds`. Items whose id appears
 * in `orderedIds` come first (in that order); any remaining items are appended
 * in their original relative order. Unknown ids in `orderedIds` are ignored.
 */
export function orderProjectsByIds<T extends { id: string }>(
    items: T[],
    orderedIds: string[],
): T[] {
    const byId = new Map(items.map((item) => [item.id, item]));
    const result: T[] = [];
    const used = new Set<string>();
    for (const id of orderedIds) {
        const item = byId.get(id);
        if (item && !used.has(id)) {
            result.push(item);
            used.add(id);
        }
    }
    for (const item of items) {
        if (!used.has(item.id)) {
            result.push(item);
        }
    }
    return result;
}

/**
 * Build a full id ordering from a reordering of only the visible subset.
 * Walks `fullIds`; positions holding a visible id are filled, in order, by
 * `visibleIdsInNewOrder`, while every other id keeps its absolute position.
 */
export function buildReorderedProjectIds(
    fullIds: string[],
    visibleIdsInNewOrder: string[],
): string[] {
    const visibleSet = new Set(visibleIdsInNewOrder);
    const queue = [...visibleIdsInNewOrder];
    return fullIds.map((id) => (visibleSet.has(id) ? (queue.shift() ?? id) : id));
}
