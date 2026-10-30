function createEditorPreviewAccess() {
    let allowed = false;
    return {
        reset() {
            allowed = false;
        },
        allow() {
            allowed = true;
        },
        canEdit() {
            return allowed;
        },
        async save(write: () => Promise<void>): Promise<boolean> {
            if (!allowed) return false;
            await write();
            return true;
        },
    };
}
export { createEditorPreviewAccess };
