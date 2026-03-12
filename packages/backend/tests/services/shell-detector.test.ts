import { describe, expect, it } from "bun:test";
import type { ShellInfo } from "@taskflow/shared";
import { resolveSystemShellPath } from "../../src/services/shell-detector";

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
