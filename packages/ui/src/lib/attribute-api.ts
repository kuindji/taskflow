import type {
    AttrCreatePayload,
    AttrDeletePayload,
    AttrUpdatePayload,
    AttributeOwner,
} from "@taskflow/shared";
import { MSG } from "@taskflow/shared";
import { sendRequest } from "@/hooks/useWebSocket";

async function createAttribute(owner: AttributeOwner, name: string, value: string): Promise<void> {
    const payload: AttrCreatePayload = { ...owner, name, value };
    await sendRequest(MSG.ATTR_CREATE, payload);
}

async function updateAttribute(
    owner: AttributeOwner,
    attrId: string,
    updates: { name?: string; value?: string },
): Promise<void> {
    const payload: AttrUpdatePayload = { ...owner, attrId, ...updates };
    await sendRequest(MSG.ATTR_UPDATE, payload);
}

async function deleteAttribute(owner: AttributeOwner, attrId: string): Promise<void> {
    const payload: AttrDeletePayload = { ...owner, attrId };
    await sendRequest(MSG.ATTR_DELETE, payload);
}

export { createAttribute, deleteAttribute, updateAttribute };
