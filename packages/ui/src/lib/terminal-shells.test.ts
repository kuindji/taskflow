import { describe, expect, it } from "bun:test";
import { getShellNameFromPath, getShellSessionLabel } from "./terminal-shells";

describe("terminal shell labels", () => {
    it("derives shell session labels from the shell path basename", () => {
        expect(getShellSessionLabel("/bin/zsh")).toBe("zsh");
    });

    it("formats shell display names independently of session labels", () => {
        expect(getShellNameFromPath("/bin/zsh")).toBe("Zsh");
    });
});
