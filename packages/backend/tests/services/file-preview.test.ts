import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { readFilePreview, readGitPreview } from "../../src/services/file-preview";
import { GitQueryLimitError } from "../../src/services/git-helpers";
import { expectRejects } from "../expect-rejects";

const LIMIT = 5 * 1024 * 1024;
let dir: string;
beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "preview-"));
});
afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
});

test("exactly 5 MiB of text is readable", async () => {
    const text = "é".repeat(LIMIT / 2);
    await writeFile(join(dir, "file"), text);
    expect(await readFilePreview(join(dir, "file"))).toEqual({ content: text });
});
test("a file larger than 5 MiB has no content field", async () => {
    await writeFile(join(dir, "file"), Buffer.alloc(LIMIT + 1));
    expect(await readFilePreview(join(dir, "file"))).toEqual({ state: "tooLarge" });
});
test("a growing file cannot escape the preview cap", async () => {
    let bytesRead = 0;
    let closed = false;
    const result = await readFilePreview("growing", {
        open: async () => ({
            size: async () => 1,
            read: async (buffer) => {
                bytesRead += buffer.length;
                buffer.fill(120);
                return buffer.length;
            },
            close: async () => {
                closed = true;
            },
        }),
    });
    expect(result).toEqual({ state: "tooLarge" });
    expect(bytesRead).toBe(LIMIT + 1);
    expect(closed).toBe(true);
});
test("NUL in the first 8 KiB returns binary", async () => {
    const bytes = Buffer.alloc(8193, 120);
    bytes[8191] = 0;
    await writeFile(join(dir, "file"), bytes);
    expect(await readFilePreview(join(dir, "file"))).toEqual({ state: "binary" });
});
test("NUL after the first 8 KiB does not trigger the binary rule", async () => {
    const bytes = Buffer.alloc(8193, 120);
    bytes[8192] = 0;
    await writeFile(join(dir, "file"), bytes);
    expect(await readFilePreview(join(dir, "file"))).toEqual({ content: bytes.toString() });
});
test("preview handles close after read errors", async () => {
    let closed = false;
    await expectRejects(
        readFilePreview("failed", {
            open: async () => ({
                size: async () => 0,
                read: async () => {
                    throw new Error("read failed");
                },
                close: async () => {
                    closed = true;
                },
            }),
        }),
        "read failed",
    );
    expect(closed).toBe(true);
});
test("blob limits and query failures do not become an empty side", async () => {
    expect(
        await readGitPreview(dir, "HEAD:x", {
            git: async () => {
                throw new GitQueryLimitError("output", "Git query output limit exceeded");
            },
        }),
    ).toEqual({ state: "tooLarge" });
    await expectRejects(
        readGitPreview(dir, "HEAD:x", {
            git: async () => {
                throw new GitQueryLimitError("timeout", "Git query timed out after 30 seconds");
            },
        }),
        "Git query timed out after 30 seconds",
    );
    await expectRejects(
        readGitPreview(dir, "HEAD:x", {
            git: async () => {
                throw new Error("corrupt object");
            },
        }),
        "corrupt object",
    );
});
