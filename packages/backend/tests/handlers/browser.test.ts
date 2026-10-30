import { beforeEach, expect, it, mock } from "bun:test";
import { MSG, type BrowserTab, type BrowserTabOpenPayload } from "@taskflow/shared";
import { TestRouter } from "../test-router";
import { expectRejects } from "../expect-rejects";
import { registerBrowserHandlers } from "../../src/handlers/browser";
import type { BrowserTabService } from "../../src/services/browser-tab-service";

const tab: BrowserTab = {
    id: "tab-1",
    scope: { kind: "master" },
    url: "https://example.com",
    label: "Example",
    createdAt: "2026-10-30T00:00:00.000Z",
    loaded: true,
    agentConnections: 0,
};
const fake = {
    list: mock(() => ({ tabs: [tab], hostAvailable: true })),
    open: mock(async (_input: BrowserTabOpenPayload) => tab),
    close: mock(async (id: string) => id === tab.id),
};
let router: TestRouter;

beforeEach(() => {
    for (const fn of Object.values(fake)) fn.mockClear();
    router = new TestRouter();
    registerBrowserHandlers({ router, browserTabService: fake as unknown as BrowserTabService });
});

it("lists browser tabs through the router", async () => {
    expect(await router.handle(MSG.BROWSER_TABS_LIST, {})).toEqual({
        tabs: [tab],
        hostAvailable: true,
    });
    expect(fake.list).toHaveBeenCalledWith();
});

it("opens a browser tab through the router", async () => {
    const input = { scope: tab.scope, url: tab.url, label: tab.label };
    expect(await router.handle(MSG.BROWSER_TAB_OPEN, input)).toEqual(tab);
    expect(fake.open).toHaveBeenCalledWith(input);
});

it("closes a browser tab through the router", async () => {
    expect(await router.handle(MSG.BROWSER_TAB_CLOSE, { id: tab.id })).toEqual({ success: true });
    expect(fake.close).toHaveBeenCalledWith(tab.id);
});

it("close of an unknown id rejects with Browser tab not found", async () => {
    await expectRejects(
        router.handle(MSG.BROWSER_TAB_CLOSE, { id: "unknown" }),
        /^Browser tab not found$/,
    );
});
