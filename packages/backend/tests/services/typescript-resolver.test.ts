import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, mkdir, realpath, rm, writeFile } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { resolveImport, resolveTsconfig } from "../../src/services/typescript-resolver";

describe("typescript resolver", () => {
    let dir: string;

    beforeEach(async () => {
        dir = await realpath(await mkdtemp(join(tmpdir(), "taskflow-ts-resolver-test-")));
        await mkdir(join(dir, "src"));
        await mkdir(join(dir, "old"));
        await mkdir(join(dir, "new"));
        await writeFile(join(dir, "src", "main.ts"), 'import "@/item";\n');
        await writeFile(join(dir, "old", "item.ts"), "export {};\n");
        await writeFile(join(dir, "new", "item.ts"), "export {};\n");
    });

    afterEach(async () => {
        await rm(dir, { recursive: true, force: true });
    });

    function writeTsconfig(target: string): Promise<void> {
        return writeFile(
            join(dir, "tsconfig.json"),
            JSON.stringify({
                compilerOptions: { baseUrl: ".", paths: { "@/*": [`${target}/*`] } },
            }),
        );
    }

    it("follows a path alias changed after the first resolution", async () => {
        await writeTsconfig("old");
        const source = join(dir, "src", "main.ts");
        expect(await resolveImport(source, "@/item")).toBe(join(dir, "old", "item.ts"));

        await writeTsconfig("new");
        expect(await resolveImport(source, "@/item")).toBe(join(dir, "new", "item.ts"));
        expect((await resolveTsconfig(source)).compilerOptions.paths).toEqual({
            "@/*": ["new/*"],
        });
    });

    it("finds a tsconfig created after a lookup that found none", async () => {
        const source = join(dir, "src", "main.ts");
        expect((await resolveTsconfig(source)).tsconfigPath).toBeNull();

        await writeTsconfig("old");
        expect((await resolveTsconfig(source)).tsconfigPath).toBe(join(dir, "tsconfig.json"));
    });
});
