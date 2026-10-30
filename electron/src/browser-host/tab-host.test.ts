import { expect, test } from "bun:test";
import { TabHost, type HostedView, type TabHostEvents, type ViewFactory } from "./tab-host";

function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((done) => {
        resolve = done;
    });
    return { promise, resolve };
}

function fakeView(targetId = "target-a") {
    const calls: unknown[][] = [];
    let state = { canGoBack: false, canGoForward: false };
    const view: HostedView = {
        targetId,
        url: () => "https://example.com/",
        title: () => "Example",
        show: (bounds) => {
            calls.push(["show", bounds]);
        },
        hide: () => {
            calls.push(["hide"]);
        },
        navigate: (url) => {
            calls.push(["navigate", url]);
        },
        back: () => {
            calls.push(["back"]);
        },
        forward: () => {
            calls.push(["forward"]);
        },
        reload: () => {
            calls.push(["reload"]);
        },
        navState: () => state,
        capture: () => {
            calls.push(["capture"]);
            return Promise.resolve("data:image/png;base64,a");
        },
        destroy: () => {
            calls.push(["destroy"]);
        },
    };
    return {
        view,
        calls,
        setState: (next: typeof state) => {
            state = next;
        },
    };
}

function setup(create?: ViewFactory["create"]) {
    const fake = fakeView();
    const creations: Parameters<ViewFactory["create"]>[0][] = [];
    const emitted: unknown[][] = [];
    const events: TabHostEvents = {
        navigated: (...args) => {
            emitted.push(["navigated", ...args]);
        },
        childOpened: (...args) => {
            emitted.push(["childOpened", ...args]);
        },
        closed: (...args) => {
            emitted.push(["closed", ...args]);
        },
        navState: (...args) => {
            emitted.push(["navState", ...args]);
        },
        loadedChanged: () => {
            emitted.push(["loadedChanged"]);
        },
    };
    const host = new TabHost(
        {
            create: (req) => {
                creations.push(req);
                return create ? create(req) : Promise.resolve(fake.view);
            },
            appTargetIds: () => Promise.resolve(["app"]),
        },
        events,
    );
    return { host, ...fake, creations, emitted };
}

const request = { tabId: "a", url: "https://example.com/" };
const bounds = { x: 10, y: 20, width: 600, height: 400 };

test("ensure creates once for concurrent calls and returns the targetId", async () => {
    const { host, creations } = setup();
    expect(await Promise.all([host.ensure(request), host.ensure(request)])).toEqual([
        { targetId: "target-a" },
        { targetId: "target-a" },
    ]);
    expect(creations).toEqual([request]);
});

test("ensure of a loaded tab does not create again", async () => {
    const { host, creations } = setup();
    await host.ensure(request);
    expect(await host.ensure(request)).toEqual({ targetId: "target-a" });
    expect(creations).toHaveLength(1);
});

test("show ensures then shows at bounds; hide hides", async () => {
    const { host, calls } = setup();
    await host.show("a", request.url, bounds);
    host.hide("a");
    expect(calls).toEqual([["show", bounds], ["hide"]]);
});

test("show of an already loaded tab emits navState with the view's current state", async () => {
    const { host, emitted, setState } = setup();
    await host.ensure(request);
    setState({ canGoBack: true, canGoForward: false });
    await host.show("a", request.url, bounds);
    expect(emitted).toContainEqual(["navState", "a", { canGoBack: true, canGoForward: false }]);
});

test("freeze captures then hides and returns the data url", async () => {
    const { host, calls } = setup();
    await host.ensure(request);
    expect(await host.freeze("a")).toBe("data:image/png;base64,a");
    expect(calls).toEqual([["capture"], ["hide"]]);
});

test("close destroys the view, removes it from loaded and fires loadedChanged", async () => {
    const { host, calls, emitted } = setup();
    await host.ensure(request);
    emitted.length = 0;
    host.close("a");
    expect(calls).toEqual([["destroy"]]);
    expect(host.loaded()).toEqual([]);
    expect(emitted).toContainEqual(["loadedChanged"]);
});

test("reportChildOpened registers a new tab, fires childOpened with the parent and loadedChanged", async () => {
    const { host, emitted } = setup();
    await host.ensure(request);
    emitted.length = 0;
    const child = fakeView("child");
    const id = host.reportChildOpened("a", child.view, "oauth");
    expect(id).not.toBe("a");
    expect(emitted).toEqual([["childOpened", id, "a", request.url, "child"], ["loadedChanged"]]);
    expect(host.loaded().find((tab) => tab.tabId === id)?.parentId).toBe("a");
});

test("reportClosed removes the tab and fires closed", async () => {
    const { host, emitted } = setup();
    await host.ensure(request);
    emitted.length = 0;
    host.reportClosed("a");
    expect(host.loaded()).toEqual([]);
    expect(emitted).toEqual([["closed", "a"], ["loadedChanged"]]);
});

test("detachAll hides every view without destroying any", async () => {
    const { host, calls } = setup();
    await host.ensure(request);
    const child = fakeView("child");
    host.reportChildOpened("a", child.view, "");
    host.detachAll();
    expect(calls).toEqual([["hide"]]);
    expect(child.calls).toEqual([["hide"]]);
    expect(host.loaded()).toHaveLength(2);
});

test("navigate, back, forward and reload delegate to the view; an unknown tab is a no-op", async () => {
    const { host, calls } = setup();
    await host.ensure(request);
    for (const id of ["a", "unknown"]) {
        host.navigate(id, "https://other.test/");
        host.back(id);
        host.forward(id);
        host.reload(id);
    }
    expect(calls).toEqual([["navigate", "https://other.test/"], ["back"], ["forward"], ["reload"]]);
});

test("loaded lists tabId, targetId, url, title and the parentId of children", async () => {
    const { host } = setup();
    await host.ensure(request);
    const id = host.reportChildOpened("a", fakeView("child").view, "");
    expect(host.loaded()).toEqual([
        { tabId: "a", targetId: "target-a", url: request.url, title: "Example" },
        { tabId: id, targetId: "child", url: request.url, title: "Example", parentId: "a" },
    ]);
});

test("hide during a pending show: the view is created but never shown", async () => {
    const pending = deferred<HostedView>();
    const { host } = setup(() => pending.promise);
    const fake = fakeView();
    const showing = host.show("a", request.url, bounds);
    host.hide("a");
    pending.resolve(fake.view);
    await showing;
    expect(fake.calls).toEqual([]);
    expect(host.loaded()).toHaveLength(1);
});

test("show during a pending freeze capture: the freeze returns its image and the view stays shown", async () => {
    const { host, view, calls } = setup();
    await host.ensure(request);
    const capture = deferred<string>();
    view.capture = () => capture.promise;
    const freezing = host.freeze("a");
    await host.show("a", request.url, bounds);
    capture.resolve("image");
    expect(await freezing).toBe("image");
    expect(calls).toEqual([["show", bounds]]);
});

test("detachAll during a pending show: the view is not shown", async () => {
    const pending = deferred<HostedView>();
    const { host } = setup(() => pending.promise);
    const fake = fakeView();
    const showing = host.show("a", request.url, bounds);
    host.detachAll();
    pending.resolve(fake.view);
    await showing;
    expect(fake.calls).toEqual([]);
});

test("close during a pending creation destroys the new view, leaves it out of loaded, and rejects ensure", async () => {
    const pending = deferred<HostedView>();
    const { host } = setup(() => pending.promise);
    const fake = fakeView();
    const ensuring = host.ensure(request);
    host.close("a");
    pending.resolve(fake.view);
    await ensuring.then(
        () => {
            throw new Error("Expected ensure to reject");
        },
        (error: unknown) => {
            expect(error).toBeInstanceOf(Error);
        },
    );
    expect(fake.calls).toEqual([["destroy"]]);
    expect(host.loaded()).toEqual([]);
});

test("freeze of a tab with no view returns an empty string", async () => {
    expect(await setup().host.freeze("missing")).toBe("");
});

test("freeze returns an empty string when capture resolves empty, and still hides", async () => {
    const { host, view, calls } = setup();
    await host.ensure(request);
    view.capture = () => Promise.resolve("");
    expect(await host.freeze("a")).toBe("");
    expect(calls).toEqual([["hide"]]);
});

test("claimPopupName allows an empty name, a free name, and a name owned by the same family", async () => {
    const { host } = setup();
    await host.ensure(request);
    expect(host.claimPopupName("a", "")).toBe(true);
    expect(host.claimPopupName("a", "oauth")).toBe(true);
    const child = host.reportChildOpened("a", fakeView("child").view, "oauth");
    expect(host.claimPopupName(child, "oauth")).toBe(true);
});

test("claimPopupName refuses a name owned by another family", async () => {
    const { host } = setup();
    await host.ensure(request);
    await host.ensure({ ...request, tabId: "b" });
    host.reportChildOpened("a", fakeView("child").view, "oauth");
    expect(host.claimPopupName("b", "oauth")).toBe(false);
});

test("claimPopupName reserves: family A claims \"oauth\", family B's claim is refused before A's popup is reported", async () => {
    const { host } = setup();
    await host.ensure(request);
    await host.ensure({ ...request, tabId: "b" });
    expect(host.claimPopupName("a", "oauth")).toBe(true);
    expect(host.claimPopupName("b", "oauth")).toBe(false);
});

test("reportClosed of the named child frees its name", async () => {
    const { host } = setup();
    await host.ensure(request);
    const child = host.reportChildOpened("a", fakeView("child").view, "oauth");
    host.reportClosed(child);
    expect(host.claimPopupName("b", "oauth")).toBe(true);
});

test("closing a family root frees its unused reservations", async () => {
    const { host } = setup();
    await host.ensure(request);
    host.claimPopupName("a", "oauth");
    host.close("a");
    expect(host.claimPopupName("b", "oauth")).toBe(true);
});
