import { expect } from "bun:test";

/**
 * Await a promise that must reject with an Error, optionally matching its message.
 * Stands in for `await expect(p).rejects.toThrow()`, which bun:test types as a
 * non-Promise and so trips `@typescript-eslint/await-thenable`.
 */
async function expectRejects(promise: Promise<unknown>, message?: string | RegExp): Promise<void> {
    let error: unknown;
    try {
        await promise;
    } catch (caught) {
        error = caught;
    }
    if (!(error instanceof Error)) throw new Error("Expected the promise to reject with an Error");
    if (message !== undefined) expect(error.message).toMatch(message);
}

export { expectRejects };
