import type {
    AttrCreatePayload,
    AttrDeletePayload,
    AttrUpdatePayload,
    AttributeOwner,
} from "@taskflow/shared";
import { MSG } from "@taskflow/shared";
import { sendRequest } from "@/lib/connection-registry";

// `backendId` is the owning record's machine: a debounced save can outlive the
// panel that scheduled it, so it cannot ask the open workspace where to go.

async function createAttribute(
    backendId: string,
    owner: AttributeOwner,
    name: string,
    value: string,
): Promise<void> {
    const payload: AttrCreatePayload = { ...owner, name, value };
    await sendRequest(backendId, MSG.ATTR_CREATE, payload);
}

async function updateAttribute(
    backendId: string,
    owner: AttributeOwner,
    attrId: string,
    updates: { name?: string; value?: string },
): Promise<void> {
    const payload: AttrUpdatePayload = { ...owner, attrId, ...updates };
    await sendRequest(backendId, MSG.ATTR_UPDATE, payload);
}

async function deleteAttribute(
    backendId: string,
    owner: AttributeOwner,
    attrId: string,
): Promise<void> {
    const payload: AttrDeletePayload = { ...owner, attrId };
    await sendRequest(backendId, MSG.ATTR_DELETE, payload);
}

export { createAttribute, deleteAttribute, updateAttribute };
