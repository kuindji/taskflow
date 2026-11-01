import { afterEach, expect, test } from "bun:test";
import { MSG, bundledThemes } from "@taskflow/shared";
import { closeConnection, openConnection, setPrimary } from "@/lib/connection-registry";
import { startTestServer, type TestServer } from "@/lib/test-ws-server";
import { useThemeStore } from "./theme-store";

const servers: TestServer[] = [];

afterEach(() => {
    closeConnection("a", "detach");
    servers.splice(0).forEach((server) => server.stop());
});

test("a theme picked while the list is loading survives the list's arrival", async () => {
    const [first, second] = bundledThemes;
    let releaseList: () => void = () => {};
    const listHeld = new Promise<void>((resolve) => {
        releaseList = resolve;
    });
    const server = startTestServer("a", async (type) => {
        if (type === MSG.THEMES_LIST) {
            await listHeld;
            return { themes: bundledThemes };
        }
        if (type === MSG.SETTINGS_UPDATE) return {};
        return {};
    });
    servers.push(server);
    await openConnection("a", server.origin);
    setPrimary("a");
    await useThemeStore.getState().activateTheme(first.id);

    // The Appearance dialog opens with `first` active and asks for the list.
    const fetching = useThemeStore.getState().fetchThemes({ preferredThemeId: first.id });
    await useThemeStore.getState().activateTheme(second.id);
    releaseList();
    await fetching;

    expect(useThemeStore.getState().activeThemeId).toBe(second.id);
});
