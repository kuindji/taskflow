import type { Attribute, AttributeLayer, ResolvedAttribute } from "../types/attribute";

function normalizeAttributeName(name: string): string {
    return name.trim();
}

function hasNameConflict(list: Attribute[], name: string, ignoreId?: string): boolean {
    const normalized = normalizeAttributeName(name);
    return list.some((a) => a.id !== ignoreId && a.name === normalized);
}

/**
 * Merge attribute layers, lowest precedence first. A name defined in a higher
 * layer shadows the same name in every lower layer, and the shadowed entry is
 * omitted from the result entirely.
 */
function resolveAttributes(layers: AttributeLayer[]): ResolvedAttribute[] {
    const winners = new Map<string, ResolvedAttribute>();
    for (const layer of layers) {
        for (const attribute of layer.attributes) {
            winners.set(attribute.name, { ...attribute, scope: layer.scope });
        }
    }

    const resolved: ResolvedAttribute[] = [];
    for (const layer of layers) {
        for (const attribute of layer.attributes) {
            const winner = winners.get(attribute.name);
            if (winner && winner.id === attribute.id) {
                resolved.push(winner);
            }
        }
    }
    return resolved;
}

export { hasNameConflict, normalizeAttributeName, resolveAttributes };
