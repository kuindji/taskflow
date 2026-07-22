import type { AttributeOwner } from "@taskflow/shared";
import { MSG } from "@taskflow/shared";
import { sendRequest } from "@/hooks/useWebSocket";

async function createAttribute(owner: AttributeOwner, name: string, value: string): Promise<void> {
    await sendRequest(MSG.ATTR_CREATE, { ...owner, name, value });
}

async function updateAttribute(
    owner: AttributeOwner,
    attrId: string,
    updates: { name?: string; value?: string },
): Promise<void> {
    await sendRequest(MSG.ATTR_UPDATE, { ...owner, attrId, ...updates });
}

async function deleteAttribute(owner: AttributeOwner, attrId: string): Promise<void> {
    await sendRequest(MSG.ATTR_DELETE, { ...owner, attrId });
}

export { createAttribute, deleteAttribute, updateAttribute };
