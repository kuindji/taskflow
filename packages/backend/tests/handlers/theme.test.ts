import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { MSG } from "@taskflow/shared";
import type {
    ThemeBrowseListResponse,
    ThemeDownloadResponse,
    ThemeSource,
} from "@taskflow/shared";
import { registerThemeHandlers } from "../../src/handlers/theme";
import { ThemeService } from "../../src/services/theme-service";
import { Router } from "../../src/ws/router";

describe("theme handlers", () => {
    let tempDir: string;
    let router: Router;
    let service: ThemeService;
    let originalFetch: typeof globalThis.fetch;

    beforeEach(async () => {
        tempDir = await mkdtemp(join(tmpdir(), "taskflow-theme-handler-"));
        router = new Router();
        service = new ThemeService(tempDir);
        registerThemeHandlers(router, service);
        originalFetch = globalThis.fetch;
    });

    afterEach(async () => {
        globalThis.fetch = originalFetch;
        await rm(tempDir, { recursive: true, force: true });
    });

    it("rejects invalid import payloads", async () => {
        // eslint-disable-next-line @typescript-eslint/await-thenable -- bun:test .rejects.toThrow() returns a Promise at runtime
        await expect(
            router.handle(MSG.THEME_IMPORT, {
                theme: {
                    name: "Bad Payload",
                },
            }),
        ).rejects.toThrow("Invalid theme source");
    });

    it("rejects invalid delete payloads", async () => {
        // eslint-disable-next-line @typescript-eslint/await-thenable -- bun:test .rejects.toThrow() returns a Promise at runtime
        await expect(
            router.handle(MSG.THEME_DELETE, {
                id: "../../etc/passwd",
            }),
        ).rejects.toThrow("Invalid theme id");
    });

    it("browse list ignores hand-dropped files that shadow online catalog ids", async () => {
        const shadowTheme: ThemeSource = {
            version: 1,
            name: "Shadow One Dark",
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
        };
        await writeFile(
            join(tempDir, "terminalcolors-one-dark.json"),
            JSON.stringify(shadowTheme, null, 2),
        );

        const response = await router.handle(
            MSG.THEME_BROWSE_LIST,
            {},
        ) as ThemeBrowseListResponse;
        const oneDark = response.themes.find((theme) => theme.id === "terminalcolors-one-dark");

        expect(oneDark).toBeDefined();
        expect(oneDark?.installed).toBe(false);
        expect(oneDark?.installedThemeId).toBeUndefined();
    });

    it("downloads online themes without overwriting colliding hand-dropped files", async () => {
        const shadowTheme: ThemeSource = {
            version: 1,
            name: "Shadow One Dark",
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
        };
        await writeFile(
            join(tempDir, "terminalcolors-one-dark.json"),
            JSON.stringify(shadowTheme, null, 2),
        );

        globalThis.fetch = Object.assign(
            async () =>
                new Response(
                    [
                        "[colors.primary]",
                        'foreground = "#abb2bf"',
                        'background = "#282c34"',
                        "[colors.normal]",
                        'black = "#282c34"',
                        'red = "#e06c75"',
                        'green = "#98c379"',
                        'yellow = "#e5c07b"',
                        'blue = "#61afef"',
                        'magenta = "#c678dd"',
                        'cyan = "#56b6c2"',
                        'white = "#abb2bf"',
                        "[colors.bright]",
                        'black = "#545862"',
                        'red = "#e06c75"',
                        'green = "#98c379"',
                        'yellow = "#e5c07b"',
                        'blue = "#61afef"',
                        'magenta = "#c678dd"',
                        'cyan = "#56b6c2"',
                        'white = "#c8ccd4"',
                        "[colors.cursor]",
                        'text = "#282c34"',
                        'cursor = "#528bff"',
                        "[colors.selection]",
                        'text = "#abb2bf"',
                        'background = "#3e4451"',
                    ].join("\n"),
                    { status: 200 },
                ),
            { preconnect: originalFetch.preconnect },
        ) as typeof globalThis.fetch;

        const response = await router.handle(MSG.THEME_DOWNLOAD, {
            id: "terminalcolors-one-dark",
            url: "https://terminalcolors.com/downloads/alacritty/one-dark.toml",
            name: "One Dark",
        }) as ThemeDownloadResponse;

        expect(response.importedThemeId).toBe("terminalcolors-one-dark-2");

        const shadowFile = JSON.parse(
            await readFile(join(tempDir, "terminalcolors-one-dark.json"), "utf-8"),
        ) as ThemeSource;
        expect(shadowFile.name).toBe("Shadow One Dark");

        const installedFile = JSON.parse(
            await readFile(join(tempDir, "terminalcolors-one-dark-2.json"), "utf-8"),
        ) as ThemeSource;
        expect(installedFile.origin).toBe("online");
        expect(installedFile.name).toBe("One Dark");

        const browseResponse = await router.handle(
            MSG.THEME_BROWSE_LIST,
            {},
        ) as ThemeBrowseListResponse;
        const oneDark = browseResponse.themes.find((theme) => theme.id === "terminalcolors-one-dark");
        expect(oneDark?.installed).toBe(true);
        expect(oneDark?.installedThemeId).toBe("terminalcolors-one-dark-2");
    });
});
