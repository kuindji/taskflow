import type { Attribute } from "@taskflow/shared";
import { hasNameConflict, normalizeAttributeName } from "@taskflow/shared";

function requireValidName(list: Attribute[], name: string, ignoreId?: string): string {
    const normalized = normalizeAttributeName(name);
    if (!normalized) {
        throw new Error("Attribute name cannot be empty");
    }
    if (hasNameConflict(list, normalized, ignoreId)) {
        throw new Error(`Attribute name already exists: "${normalized}"`);
    }
    return normalized;
}

function addAttribute(list: Attribute[], id: string, name: string, value: string): Attribute[] {
    const normalized = requireValidName(list, name);
    return [...list, { id, name: normalized, value }];
}

function editAttribute(
    list: Attribute[],
    id: string,
    updates: { name?: string; value?: string },
): Attribute[] {
    const index = list.findIndex((a) => a.id === id);
    if (index === -1) {
        throw new Error(`Attribute not found: ${id}`);
    }
    const current = list[index];
    const name =
        updates.name === undefined ? current.name : requireValidName(list, updates.name, id);
    const value = updates.value === undefined ? current.value : updates.value;
    const next = [...list];
    next[index] = { id, name, value };
    return next;
}

function removeAttribute(list: Attribute[], id: string): Attribute[] {
    if (!list.some((a) => a.id === id)) {
        throw new Error(`Attribute not found: ${id}`);
    }
    return list.filter((a) => a.id !== id);
}

export { addAttribute, editAttribute, removeAttribute };
