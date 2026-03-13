import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, writeFile, readFile } from "fs/promises";
import { join } from "path";
import { win32 } from "path";
import { tmpdir } from "os";
import type { ThemeSource } from "@taskflow/shared";
import { bundledThemes } from "@taskflow/shared";
import { isPathInsideDirectory, ThemeService } from "../../src/services/theme-service";

function makeValidSource(overrides: Partial<ThemeSource> = {}): ThemeSource {
    return {
        version: 1,
        name: "Test Theme",
        origin: "custom",
        colors: {
            foreground: "#ffffff",
            background: "#000000",
            cursor: "#ffffff",
            cursorText: "#000000",
            selection: "#444444",
            selectionText: "#ffffff",
            ansi: {
                black: "#000000",
                red: "#ff0000",
                green: "#00ff00",
                yellow: "#ffff00",
                blue: "#0000ff",
                magenta: "#ff00ff",
                cyan: "#00ffff",
                white: "#ffffff",
                brightBlack: "#808080",
                brightRed: "#ff8080",
                brightGreen: "#80ff80",
                brightYellow: "#ffff80",
                brightBlue: "#8080ff",
                brightMagenta: "#ff80ff",
                brightCyan: "#80ffff",
                brightWhite: "#ffffff",
            },
        },
        ...overrides,
    };
}

describe("ThemeService", () => {
    let tempDir: string;
    let service: ThemeService;

    beforeEach(async () => {
        tempDir = await mkdtemp(join(tmpdir(), "theme-service-test-"));
        service = new ThemeService(tempDir);
    });

    afterEach(async () => {
        await rm(tempDir, { recursive: true, force: true });
    });

    describe("listAll", () => {
        it("lists bundled themes", async () => {
            const themes = await service.listAll();
            expect(themes.length).toBeGreaterThanOrEqual(6);
            const ids = themes.map((t) => t.id);
            expect(ids).toContain("catppuccin-mocha");
            expect(ids).toContain("dracula");
        });

        it("lists user themes from directory", async () => {
            const source = makeValidSource({ name: "My Custom" });
            await writeFile(
                join(tempDir, "my-custom.json"),
                JSON.stringify(source),
            );

            const themes = await service.listAll();
            const userTheme = themes.find((t) => t.id === "my-custom");
            expect(userTheme).toBeDefined();
            expect(userTheme!.source.name).toBe("My Custom");
        });

        it("skips invalid JSON files gracefully", async () => {
            await writeFile(join(tempDir, "broken.json"), "not json {{{");

            const themes = await service.listAll();
            const ids = themes.map((t) => t.id);
            expect(ids).not.toContain("broken");
            // Should still have bundled themes
            expect(themes.length).toBeGreaterThanOrEqual(6);
        });

        it("skips files with unknown version", async () => {
            const source = makeValidSource();
            const raw = { ...source, version: 99 };
            await writeFile(
                join(tempDir, "bad-version.json"),
                JSON.stringify(raw),
            );

            const themes = await service.listAll();
            const ids = themes.map((t) => t.id);
            expect(ids).not.toContain("bad-version");
        });

        it("skips user files whose filename collides with bundled ID", async () => {
            const source = makeValidSource({ name: "Fake Dracula" });
            await writeFile(
                join(tempDir, "dracula.json"),
                JSON.stringify(source),
            );

            const themes = await service.listAll();
            const draculas = themes.filter((t) => t.id === "dracula");
            expect(draculas.length).toBe(1);
            // The one that remains should be bundled
            expect(draculas[0].source.name).not.toBe("Fake Dracula");
        });

        it("skips files with invalid origin", async () => {
            const source = makeValidSource();
            const raw = { ...source, origin: "garbage" };
            await writeFile(
                join(tempDir, "bad-origin.json"),
                JSON.stringify(raw),
            );

            const themes = await service.listAll();
            const ids = themes.map((t) => t.id);
            expect(ids).not.toContain("bad-origin");
        });

        it("skips files that don't satisfy full schema (missing colors fields)", async () => {
            const incomplete = {
                version: 1,
                name: "Incomplete",
                origin: "custom",
                colors: {
                    foreground: "#ffffff",
                    background: "#000000",
                    // missing cursor, cursorText, selection, selectionText, ansi
                },
            };
            await writeFile(
                join(tempDir, "incomplete.json"),
                JSON.stringify(incomplete),
            );

            const themes = await service.listAll();
            const ids = themes.map((t) => t.id);
            expect(ids).not.toContain("incomplete");
        });

        it("skips non-online files whose filename collides with an online catalog id", async () => {
            const source = makeValidSource({ name: "Shadow One Dark", origin: "custom" });
            await writeFile(
                join(tempDir, "terminalcolors-one-dark.json"),
                JSON.stringify(source),
            );

            const themes = await service.listAll();
            expect(themes.find((t) => t.id === "terminalcolors-one-dark")).toBeUndefined();
        });
    });

    describe("save", () => {
        it("saves a theme and it appears in listAll", async () => {
            const source = makeValidSource({ name: "New Theme" });
            const record = await service.save(source);

            expect(record.id).toBe("new-theme");
            expect(record.source.name).toBe("New Theme");

            const themes = await service.listAll();
            const found = themes.find((t) => t.id === "new-theme");
            expect(found).toBeDefined();
        });

        it("suffixes IDs that collide with bundled themes", async () => {
            const source = makeValidSource({ name: "Dracula" });
            const record = await service.save(source);

            expect(record.id).toBe("dracula-2");

            // Verify the file was written
            const raw = await readFile(
                join(tempDir, "dracula-2.json"),
                "utf-8",
            );
            const parsed = JSON.parse(raw);
            expect(parsed.name).toBe("Dracula");
        });

        it("reuses explicit ID when overwriting existing user theme", async () => {
            const source1 = makeValidSource({ name: "My Theme" });
            const record1 = await service.save(source1, "my-theme-id");
            expect(record1.id).toBe("my-theme-id");

            const source2 = makeValidSource({ name: "My Theme Updated" });
            const record2 = await service.save(source2, "my-theme-id", {
                overwriteExisting: true,
            });
            expect(record2.id).toBe("my-theme-id");
            expect(record2.source.name).toBe("My Theme Updated");

            // Should only appear once
            const themes = await service.listAll();
            const matches = themes.filter((t) => t.id === "my-theme-id");
            expect(matches.length).toBe(1);
            expect(matches[0].source.name).toBe("My Theme Updated");
        });

        it("suffixes when explicit ID collides and overwrite is false", async () => {
            const source1 = makeValidSource({ name: "First" });
            await service.save(source1, "shared-id");

            const source2 = makeValidSource({ name: "Second" });
            const record2 = await service.save(source2, "shared-id");
            expect(record2.id).toBe("shared-id-2");
        });

        it("rejects invalid theme payloads before writing", async () => {
            await expect(service.save({ name: "Bad Payload" } as ThemeSource)).rejects.toThrow(
                "Invalid theme source",
            );
        });

        it("falls back to a usable ID when the slug would be empty", async () => {
            const source = makeValidSource({ name: "東京" });
            const record = await service.save(source);

            expect(record.id).toBe("theme");
            const themes = await service.listAll();
            expect(themes.find((t) => t.id === "theme")?.source.name).toBe("東京");
        });
    });

    describe("importFromFile", () => {
        it("preserves valid JSON theme metadata like overrides", async () => {
            const source = makeValidSource({
                name: "Imported JSON Theme",
                origin: "custom",
                author: "Taskflow",
                overrides: {
                    "--background": "#123456",
                },
            });
            const sourcePath = join(tempDir, "imported.json");
            await writeFile(sourcePath, JSON.stringify(source, null, 2));

            const record = await service.importFromFile(sourcePath);

            expect(record.source.name).toBe("Imported JSON Theme");
            expect(record.source.origin).toBe("imported");
            expect(record.source.author).toBe("Taskflow");
            expect(record.source.overrides).toEqual({ "--background": "#123456" });

            const saved = JSON.parse(
                await readFile(join(tempDir, `${record.id}.json`), "utf-8"),
            ) as ThemeSource;
            expect(saved.overrides).toEqual({ "--background": "#123456" });
        });

        it("routes .terminal files through the Terminal.app parser", async () => {
            const terminalPath = join(tempDir, "classic-dark.terminal");
            await writeFile(
                terminalPath,
                `<?xml version="1.0"?>
<plist version="1.0">
<dict>
    <key>name</key><string>Classic Dark</string>
    <key>TextColor</key><dict><key>Red Component</key><real>1</real><key>Green Component</key><real>1</real><key>Blue Component</key><real>1</real></dict>
    <key>BackgroundColor</key><dict><key>Red Component</key><real>0</real><key>Green Component</key><real>0</real><key>Blue Component</key><real>0</real></dict>
    <key>ANSIBlueColor</key><dict><key>Red Component</key><real>0</real><key>Green Component</key><real>0</real><key>Blue Component</key><real>1</real></dict>
</dict>
</plist>`,
            );

            const record = await service.importFromFile(terminalPath);

            expect(record.source.name).toBe("Classic Dark");
            expect(record.source.colors.background).toBe("#000000");
            expect(record.source.colors.ansi.blue).toBe("#0000ff");
        });
    });

    describe("delete", () => {
        it("deletes a user theme", async () => {
            const source = makeValidSource({ name: "To Delete" });
            const record = await service.save(source);
            expect(record.id).toBe("to-delete");

            let themes = await service.listAll();
            expect(themes.find((t) => t.id === "to-delete")).toBeDefined();

            await service.delete("to-delete");

            themes = await service.listAll();
            expect(themes.find((t) => t.id === "to-delete")).toBeUndefined();
        });

        it("rejects path traversal IDs", async () => {
            await expect(service.delete("../../etc/passwd")).rejects.toThrow(
                "Invalid theme id",
            );
        });

        it("is a no-op for bundled theme IDs", async () => {
            // Should not throw
            await service.delete("dracula");

            const themes = await service.listAll();
            expect(themes.find((t) => t.id === "dracula")).toBeDefined();
        });
    });

    describe("idFor", () => {
        it("converts name to slug ID", () => {
            expect(service.idFor("My Cool Theme")).toBe("my-cool-theme");
            expect(service.idFor("  Spaces  ")).toBe("spaces");
        });

        it("falls back when the slug would be empty", () => {
            expect(service.idFor("東京")).toBe("theme");
        });
    });

    describe("isPathInsideDirectory", () => {
        it("accepts valid Windows child paths", () => {
            expect(
                isPathInsideDirectory(
                    win32.resolve("C:/Users/me/AppData/Roaming/taskflow/themes"),
                    win32.resolve("C:/Users/me/AppData/Roaming/taskflow/themes/dracula.json"),
                    win32,
                ),
            ).toBe(true);
        });

        it("rejects Windows traversal paths", () => {
            expect(
                isPathInsideDirectory(
                    win32.resolve("C:/Users/me/AppData/Roaming/taskflow/themes"),
                    win32.resolve("C:/Users/me/AppData/Roaming/taskflow/etc/passwd.json"),
                    win32,
                ),
            ).toBe(false);
        });
    });
});
