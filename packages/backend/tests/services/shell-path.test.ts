import { afterEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { resolveNvmNodeBin } from "../../src/services/shell-path";

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
