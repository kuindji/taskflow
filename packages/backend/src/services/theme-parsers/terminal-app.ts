import { readdir, access } from "fs/promises";
import { join } from "path";
import { homedir } from "os";
import type { ThemeSource } from "@taskflow/shared";

// Terminal.app stores colors as NSKeyedArchiver data blobs in plist files.
// These are complex binary-encoded NSColor objects that cannot be reliably
// decoded without Objective-C bridging. This is a best-effort parser that
// returns an empty array on failure rather than crashing.

async function detectTerminalApp(): Promise<boolean> {
    // Terminal.app profiles are stored in macOS preferences.
    // .terminal files may be exported to Desktop or Downloads.
    const searchPaths = [
        join(homedir(), "Desktop"),
        join(homedir(), "Downloads"),
        join(homedir(), "Documents"),
    ];

    for (const dir of searchPaths) {
        try {
            await access(dir);
            const files = await readdir(dir);
            if (files.some((f) => f.endsWith(".terminal"))) {
                return true;
            }
        } catch {
            // Directory doesn't exist or not readable
        }
    }

    return false;
}

async function parseTerminalApp(): Promise<ThemeSource[]> {
    // NSKeyedArchiver data blobs cannot be decoded in pure JS.
    // A future version could shell out to a Swift helper, but for now
    // we return empty gracefully.
    return [];
}

export { detectTerminalApp, parseTerminalApp };
