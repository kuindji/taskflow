import { afterEach, describe, expect, it } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import type { ShellInfo } from "@taskflow/shared";
import { detectUnixShells, resolveSystemShellPath } from "../../src/services/shell-detector";

const shells: ShellInfo[] = [
    { name: "bash", path: "/bin/bash" },
    { name: "zsh", path: "/bin/zsh" },
];

describe("resolveSystemShellPath", () => {
    it("prefers the exact shell from SHELL when present", () => {
        expect(resolveSystemShellPath(shells, "/bin/zsh")).toBe("/bin/zsh");
    });

    it("falls back to a matching shell name when SHELL uses a different path", () => {
        expect(resolveSystemShellPath(shells, "/usr/local/bin/zsh")).toBe("/bin/zsh");
    });

    it("falls back to the first detected shell when SHELL is unsupported", () => {
        expect(resolveSystemShellPath(shells, "/opt/homebrew/bin/fish")).toBe("/bin/bash");
    });
});

describe.skipIf(process.platform === "win32")("detectUnixShells", () => {
    const dirs: string[] = [];

    afterEach(() => {
        for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
    });

    function fakeShell(root: string, path: string): string {
        const full = join(root, path);
        mkdirSync(join(full, ".."), { recursive: true });
        writeFileSync(full, "#!/bin/sh\n");
        chmodSync(full, 0o755);
        return full;
    }

    it("keeps the SHELL install when /etc/shells lists the same shell twice", async () => {
        const root = mkdtempSync(join(tmpdir(), "tf-shells-"));
        dirs.push(root);
        const systemBash = fakeShell(root, "bin/bash");
        const brewBash = fakeShell(root, "opt/homebrew/bin/bash");
        const zsh = fakeShell(root, "bin/zsh");
        const shellsFile = join(root, "shells");
        writeFileSync(shellsFile, [systemBash, zsh, brewBash].join("\n"));

        const detected = await detectUnixShells(shellsFile, brewBash);

        expect(detected).toEqual([
            { name: "bash", path: brewBash },
            { name: "zsh", path: zsh },
        ]);
        expect(resolveSystemShellPath(detected, brewBash)).toBe(brewBash);
    });

    it("keeps the first install when SHELL is another shell", async () => {
        const root = mkdtempSync(join(tmpdir(), "tf-shells-"));
        dirs.push(root);
        const systemBash = fakeShell(root, "bin/bash");
        const brewBash = fakeShell(root, "opt/homebrew/bin/bash");
        const zsh = fakeShell(root, "bin/zsh");
        const shellsFile = join(root, "shells");
        writeFileSync(shellsFile, [systemBash, brewBash, zsh].join("\n"));

        const detected = await detectUnixShells(shellsFile, zsh);

        expect(detected).toEqual([
            { name: "zsh", path: zsh },
            { name: "bash", path: systemBash },
        ]);
    });
});
