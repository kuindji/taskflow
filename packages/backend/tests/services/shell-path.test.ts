import { afterEach, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { resolveLoginShellPath, resolveNvmNodeBin } from "../../src/services/shell-path";

const homes: string[] = [];

function nvmHome(alias: string, versions: string[]): string {
    const home = mkdtempSync(join(tmpdir(), "tf-nvm-"));
    homes.push(home);
    mkdirSync(join(home, ".nvm", "alias"), { recursive: true });
    writeFileSync(join(home, ".nvm", "alias", "default"), `${alias}\n`);
    for (const version of versions) {
        mkdirSync(join(home, ".nvm", "versions", "node", version, "bin"), { recursive: true });
    }
    return home;
}

afterEach(() => {
    for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true });
});

describe("resolveNvmNodeBin", () => {
    it("resolves a default alias stored with its v prefix", () => {
        const home = nvmHome("v22.14.0", ["v20.1.0", "v22.14.0"]);
        expect(resolveNvmNodeBin(home)).toBe(
            join(home, ".nvm", "versions", "node", "v22.14.0", "bin"),
        );
    });

    it("resolves a major-version alias to the newest matching install", () => {
        const home = nvmHome("22", ["v22.2.0", "v22.14.0", "v23.0.0"]);
        expect(resolveNvmNodeBin(home)).toBe(
            join(home, ".nvm", "versions", "node", "v22.14.0", "bin"),
        );
    });
});

describe("resolveLoginShellPath", () => {
    const zsh = "/bin/zsh";
    const savedShell = process.env.SHELL;
    const savedZdotdir = process.env.ZDOTDIR;

    afterEach(() => {
        if (savedShell === undefined) delete process.env.SHELL;
        else process.env.SHELL = savedShell;
        if (savedZdotdir === undefined) delete process.env.ZDOTDIR;
        else process.env.ZDOTDIR = savedZdotdir;
    });

    it.skipIf(process.platform === "win32" || !existsSync(zsh))(
        "includes PATH entries added only in .zshrc",
        () => {
            const zdotdir = mkdtempSync(join(tmpdir(), "tf-zdot-"));
            homes.push(zdotdir);
            const extra = join(zdotdir, "zshrc-only-bin");
            writeFileSync(
                join(zdotdir, ".zshrc"),
                `echo "startup noise"\nexport PATH="$PATH:${extra}"\n`,
            );
            process.env.SHELL = zsh;
            process.env.ZDOTDIR = zdotdir;

            expect(resolveLoginShellPath().split(":")).toContain(extra);
        },
    );
});
