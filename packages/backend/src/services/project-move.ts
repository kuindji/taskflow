export function computeMovedOrder(
    orderedIds: string[],
    id: string,
    target: { to?: number; before?: string; after?: string },
): string[] {
    if (!orderedIds.includes(id)) {
        throw new Error(`Unknown project id: ${id}`);
    }
    const without = orderedIds.filter((x) => x !== id);

    let index: number;
    if (target.to !== undefined) {
        // 1-based, clamp into [1, without.length + 1]
        index = Math.min(Math.max(target.to, 1), without.length + 1) - 1;
    } else if (target.before !== undefined) {
        index = without.indexOf(target.before);
        if (index === -1) throw new Error(`Unknown project id: ${target.before}`);
    } else if (target.after !== undefined) {
        index = without.indexOf(target.after);
        if (index === -1) throw new Error(`Unknown project id: ${target.after}`);
        index += 1;
    } else {
        throw new Error("One of --to, --before, or --after is required");
    }

    return [...without.slice(0, index), id, ...without.slice(index)];
}
