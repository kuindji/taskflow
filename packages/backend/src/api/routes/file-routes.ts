import { stat } from "fs/promises";
import { extname } from "path";
import type { ApiRouter } from "../router";
import type { TaskStore } from "../../services/task-store";
import { assertWorkspacePath } from "../../utils/path-validation";

interface FileRouteDeps {
    apiRouter: ApiRouter;
    taskStore: TaskStore;
}

const CONTENT_TYPES: Record<string, string> = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".avif": "image/avif",
    ".bmp": "image/bmp",
    ".ico": "image/x-icon",
    ".svg": "image/svg+xml",
};

function registerFileRoutes({ apiRouter, taskStore }: FileRouteDeps): void {
    /**
     * Serve raw bytes for an asset referenced from a markdown preview.
     *
     * This is a security boundary: `assertWorkspacePath` resolves the real path
     * (following symlinks) and requires the result to sit inside a known project
     * or worktree root, so traversal, encoded traversal and symlink escapes all
     * fail closed. Nothing else about the request is trusted.
     */
    apiRouter.register("GET", "/api/file/raw", async (req) => {
        const requested = new URL(req.url).searchParams.get("path");
        if (!requested) return new Response("Missing path", { status: 400 });

        let resolved: string;
        try {
            resolved = await assertWorkspacePath(taskStore, requested);
        } catch {
            return new Response("Forbidden", { status: 403 });
        }

        let isDirectory: boolean;
        try {
            isDirectory = (await stat(resolved)).isDirectory();
        } catch {
            return new Response("Not found", { status: 404 });
        }
        if (isDirectory) return new Response("Forbidden", { status: 403 });

        const extension = extname(resolved).toLowerCase();
        const contentType = CONTENT_TYPES[extension] ?? "application/octet-stream";
        const headers: Record<string, string> = {
            "Content-Type": contentType,
            "X-Content-Type-Options": "nosniff",
            "Cache-Control": "no-cache",
        };
        // An SVG served same-origin can carry script; an <img> will not run it,
        // but a direct navigation would. Deny every subresource for these bytes.
        if (extension === ".svg") headers["Content-Security-Policy"] = "default-src 'none'";

        return new Response(Bun.file(resolved), { headers });
    });
}

export { registerFileRoutes };
