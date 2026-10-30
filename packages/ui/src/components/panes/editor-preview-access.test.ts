import { expect, test } from "bun:test";
import { createEditorPreviewAccess } from "./editor-preview-access";

test("reset denies editing and saving", async () => {
    const access = createEditorPreviewAccess();
    access.allow();
    access.reset();
    let writes = 0;
    expect(access.canEdit()).toBe(false);
    expect(
        await access.save(async () => {
            writes++;
        }),
    ).toBe(false);
    expect(writes).toBe(0);
});
test("only a complete load enables saving", async () => {
    const access = createEditorPreviewAccess();
    let writes = 0;
    expect(
        await access.save(async () => {
            writes++;
        }),
    ).toBe(false);
    access.allow();
    expect(access.canEdit()).toBe(true);
    expect(
        await access.save(async () => {
            writes++;
        }),
    ).toBe(true);
    expect(writes).toBe(1);
});
test("a failed later load cannot save an earlier buffer", async () => {
    const access = createEditorPreviewAccess();
    access.allow();
    await access.save(async () => {});
    access.reset();
    let writes = 0;
    expect(
        await access.save(async () => {
            writes++;
        }),
    ).toBe(false);
    expect(writes).toBe(0);
});
