import type { FileReadResponse, GitFileContentPair } from "@taskflow/shared";
import { open } from "fs/promises";
import { git, GitQueryLimitError } from "./git-helpers";

const PREVIEW_BYTES = 5 * 1024 * 1024;
const BINARY_PREFIX_BYTES = 8192;
const PATCH_BYTES = 1024 * 1024;

interface PreviewHandle {
    size(): Promise<number>;
    read(buffer: Uint8Array): Promise<number>;
    close(): Promise<void>;
}

async function readFilePreview(
    path: string,
    deps: { open(path: string): Promise<PreviewHandle> } = {
        open: async (path) => {
            const handle = await open(path, "r");
            return {
                size: async () => (await handle.stat()).size,
                read: async (buffer) => (await handle.read(buffer)).bytesRead,
                close: () => handle.close(),
            };
        },
    },
): Promise<FileReadResponse> {
    const handle = await deps.open(path);
    try {
        if ((await handle.size()) > PREVIEW_BYTES) return { state: "tooLarge" };
        const chunks: Buffer[] = [];
        let size = 0;
        while (size <= PREVIEW_BYTES) {
            const buffer = Buffer.allocUnsafe(Math.min(64 * 1024, PREVIEW_BYTES + 1 - size));
            const count = await handle.read(buffer);
            if (!count) break;
            size += count;
            if (size > PREVIEW_BYTES) return { state: "tooLarge" };
            chunks.push(buffer.subarray(0, count));
        }
        const bytes = Buffer.concat(chunks, size);
        if (bytes.subarray(0, BINARY_PREFIX_BYTES).includes(0)) return { state: "binary" };
        return { content: bytes.toString("utf8") };
    } finally {
        await handle.close();
    }
}

async function readGitPreview(
    repoPath: string,
    refSpec: string,
    deps: { git: typeof git } = { git },
): Promise<FileReadResponse | null> {
    let binary = false;
    let prefixBytes = 0;
    try {
        const content = await deps.git(
            ["show", "--no-ext-diff", "--no-textconv", refSpec],
            repoPath,
            {
                readOnly: true,
                maxOutputBytes: PREVIEW_BYTES,
                onStdout(chunk) {
                    const prefix = chunk.subarray(
                        0,
                        Math.max(0, BINARY_PREFIX_BYTES - prefixBytes),
                    );
                    binary ||= prefix.includes(0);
                    prefixBytes += prefix.length;
                },
            },
        );
        return binary ? { state: "binary" } : { content };
    } catch (error) {
        if (error instanceof GitQueryLimitError) {
            if (error.reason === "output") return { state: "tooLarge" };
            throw error;
        }
        try {
            await deps.git(["cat-file", "-e", refSpec], repoPath, { readOnly: true });
        } catch (existenceError) {
            if (existenceError instanceof GitQueryLimitError) throw existenceError;
            // Confirm absence without treating a corrupt repository or missing ref as an empty blob.
            const colon = refSpec.indexOf(":");
            const ref = refSpec.slice(0, colon);
            const path = refSpec.slice(colon + 1);
            if (colon >= 0) {
                if (ref)
                    await deps.git(["rev-parse", "--verify", `${ref}^{tree}`], repoPath, {
                        readOnly: true,
                    });
                const entries = await deps.git(
                    ref
                        ? ["ls-tree", "-z", ref, "--", path]
                        : ["ls-files", "--stage", "-z", "--", path],
                    repoPath,
                    { readOnly: true, literalPathspecs: true },
                );
                // A conflicted path has stages 1-3 but no stage-0 blob to show.
                const present = ref
                    ? entries !== ""
                    : entries.split("\0").some((entry) => / 0\t/.test(entry));
                if (!present) return null;
            }
        }
        throw error;
    }
}

async function readGitPatch(
    repoPath: string,
    args: string[],
    options: {
        literalPathspecs?: boolean;
        allowExitCodes?: number[];
        maxOutputBytes?: number;
    } = {},
): Promise<string | { state: "tooLarge" }> {
    try {
        const maxOutputBytes = options.maxOutputBytes ?? PATCH_BYTES;
        const patch = await git(args, repoPath, { ...options, readOnly: true, maxOutputBytes });
        return Buffer.byteLength(patch) > maxOutputBytes ? { state: "tooLarge" } : patch;
    } catch (error) {
        if (error instanceof GitQueryLimitError && error.reason === "output")
            return { state: "tooLarge" };
        throw error;
    }
}

function previewPair(
    original: FileReadResponse | null,
    modified: FileReadResponse | null,
): GitFileContentPair {
    if (original?.state === "tooLarge" || modified?.state === "tooLarge")
        return { state: "tooLarge", limit: "preview" };
    if (original?.state === "binary" || modified?.state === "binary") return { state: "binary" };
    return { original: original?.content ?? "", modified: modified?.content ?? "" };
}

export { readFilePreview, readGitPreview, readGitPatch, previewPair };
