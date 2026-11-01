import { expect, test } from "bun:test";
import type { DesktopUpdateState } from "@taskflow/shared";
import { createUpdateController, type UpdateControllerDeps } from "./update-controller";

function deferred() {
    let resolve!: (value?: unknown) => void;
    let reject!: (reason: Error) => void;
    const promise = new Promise<unknown>((yes, no) => {
        resolve = yes;
        reject = no;
    });
    return { promise, resolve, reject };
}
function fixture() {
    const checks: ReturnType<typeof deferred>[] = [];
    const downloads: ReturnType<typeof deferred>[] = [];
    const published: DesktopUpdateState[] = [];
    const exitConfirmed: boolean[] = [];
    const checkFailures: string[] = [];
    let installs = 0;
    let noUpdates = 0;
    let installEffect = () => {};
    const deps: UpdateControllerDeps = {
        checkForUpdates: () => {
            const d = deferred();
            checks.push(d);
            return d.promise;
        },
        downloadUpdate: () => {
            const d = deferred();
            downloads.push(d);
            return d.promise;
        },
        quitAndInstall: () => {
            installs++;
            installEffect();
        },
        publish: (state) => published.push(state),
        setExitConfirmed: (value) => exitConfirmed.push(value),
        now: () => "2026-10-31T00:00:00.000Z",
        showNoUpdate: () => {
            noUpdates++;
        },
        showCheckFailure: (message) => checkFailures.push(message),
    };
    const controller = createUpdateController(deps);
    const available = (version = "1.1.0") =>
        controller.receive({
            type: "update-available",
            version,
            checkedAt: "2026-10-31T00:00:01.000Z",
        });
    async function ready() {
        const check = controller.check();
        available();
        controller.receive({ type: "download-completed", version: "1.1.0" });
        checks[0].resolve();
        downloads[0].resolve();
        await check;
        await Promise.resolve();
    }
    return {
        controller,
        checks,
        downloads,
        published,
        exitConfirmed,
        checkFailures,
        available,
        ready,
        get installs() {
            return installs;
        },
        get noUpdates() {
            return noUpdates;
        },
        setInstallEffect: (effect: () => void) => {
            installEffect = effect;
        },
    };
}

test("update available downloads once", async () => {
    const f = fixture();
    const checking = f.controller.check(true);
    f.available();
    f.available();
    expect(f.downloads).toHaveLength(1);
    expect(f.published.map((s) => s.status)).toEqual(["checking", "available", "downloading"]);
    expect(f.controller.getState().downloadPercent).toBe(0);
    f.controller.receive({ type: "download-progress", percent: 43 });
    expect(f.controller.getState().downloadPercent).toBe(43);
    f.controller.receiveError("checksum");
    expect(f.checkFailures).toEqual([]);
    f.checks[0].resolve();
    f.downloads[0].reject(new Error("checksum"));
    await checking;
    await Promise.resolve();
});

test("a duplicate check is ignored while busy", async () => {
    const f = fixture();
    const checking = f.controller.check();
    await f.controller.check(true);
    expect(f.checks).toHaveLength(1);
    f.available();
    await f.controller.check();
    expect(f.checks).toHaveLength(1);
    f.checks[0].resolve();
    f.downloads[0].resolve();
    await checking;
    await Promise.resolve();
    // Use a fresh completed operation for the install-busy guard.
    const g = fixture();
    await g.ready();
    g.controller.install();
    await g.controller.check();
    expect(g.checks).toHaveLength(1);
    expect(g.controller.getState().status).toBe("installing");
});

test("a downloaded version is not downloaded again", async () => {
    const f = fixture();
    await f.ready();
    const checking = f.controller.check(true);
    f.available();
    expect(f.downloads).toHaveLength(1);
    expect(f.controller.getState()).toMatchObject({
        status: "ready",
        downloadedVersion: "1.1.0",
        downloadPercent: 100,
    });
    f.checks[1].resolve();
    await checking;
    expect(f.noUpdates).toBe(0);
});

test("an emitted error and matching rejection publish one failure", async () => {
    const f = fixture();
    const checking = f.controller.check(true);
    f.controller.receiveError("offline");
    f.controller.receiveError("offline again");
    await f.controller.retry();
    expect(f.checks).toHaveLength(1);
    f.checks[0].reject(new Error("offline"));
    await checking;
    expect(f.published.filter((s) => s.errorContext === "check")).toHaveLength(1);
    expect(f.checkFailures).toEqual(["offline"]);
    const retrying = f.controller.retry();
    f.available();
    f.controller.receiveError("checksum");
    f.downloads[0].reject(new Error("checksum"));
    await Promise.resolve();
    f.checks[1].reject(new Error("old check rejection"));
    await retrying;
    expect(f.published.filter((s) => s.errorContext === "download")).toHaveLength(1);
    expect(f.controller.getState().message).toBe("checksum");
});

test("an old check settlement does not clear an active download", async () => {
    const f = fixture();
    const checking = f.controller.check();
    f.available();
    f.checks[0].resolve();
    await checking;
    await f.controller.check();
    expect(f.checks).toHaveLength(1);
    f.controller.receiveError("download failed");
    expect(f.controller.getState().errorContext).toBe("download");
    f.downloads[0].reject(new Error("download failed"));
    await Promise.resolve();
});

test("failed check publishes readiness and reports a manual check error", async () => {
    const f = fixture();
    await f.ready();
    const checking = f.controller.check(true);
    f.controller.receiveError("offline");
    expect(f.controller.getState()).toMatchObject({
        status: "ready",
        downloadedVersion: "1.1.0",
        downloadPercent: 100,
        message: null,
        errorContext: null,
        canRetry: true,
    });
    expect(f.checkFailures).toEqual(["offline"]);
    f.checks[1].reject(new Error("offline"));
    await checking;
    const noUpdate = f.controller.check(true);
    f.controller.receive({ type: "no-update", checkedAt: "later" });
    f.controller.receive({ type: "no-update", checkedAt: "later" });
    expect(f.noUpdates).toBe(1);
    expect(f.controller.getState().status).toBe("ready");
    f.checks[2].resolve();
    await noUpdate;
    const silent = f.controller.check();
    f.controller.receive({ type: "no-update", checkedAt: "later" });
    f.checks[3].resolve();
    await silent;
    expect(f.noUpdates).toBe(1);
});

test("download retry does not call quitAndInstall", async () => {
    const f = fixture();
    const checking = f.controller.check();
    f.available();
    f.checks[0].resolve();
    f.downloads[0].reject(new Error("checksum"));
    await checking;
    await Promise.resolve();
    expect(f.controller.getState().errorContext).toBe("download");
    const retrying = f.controller.retry();
    expect(f.downloads).toHaveLength(2);
    expect(f.checks).toHaveLength(1);
    expect(f.installs).toBe(0);
    f.controller.receive({ type: "download-completed", version: "1.1.0" });
    f.downloads[1].resolve();
    await retrying;
    expect(f.controller.getState().status).toBe("ready");
});

test("install retry uses the downloaded update without downloading again", async () => {
    const f = fixture();
    await f.ready();
    f.setInstallEffect(() => {
        throw new Error("shutdown failed");
    });
    f.controller.install();
    expect(f.controller.getState()).toMatchObject({
        status: "ready",
        downloadedVersion: "1.1.0",
        errorContext: "install",
        canRetry: true,
    });
    f.setInstallEffect(() => {});
    await f.controller.retry();
    expect(f.installs).toBe(2);
    expect(f.downloads).toHaveLength(1);
    expect(f.checks).toHaveLength(1);
    expect(f.controller.getState().status).toBe("installing");
});

test("synchronous and emitted install failures restore exit confirmation", async () => {
    for (const emitted of [false, true]) {
        const f = fixture();
        await f.ready();
        f.setInstallEffect(() => {
            expect(f.controller.getState().status).toBe("installing");
            expect(f.exitConfirmed.at(-1)).toBe(true);
            if (emitted) f.controller.receiveError("install failed");
            throw new Error("install failed");
        });
        f.controller.install();
        expect(f.exitConfirmed).toEqual([true, false]);
        expect(f.published.filter((s) => s.errorContext === "install")).toHaveLength(1);
        expect(f.checkFailures).toEqual([]);
    }
    const f = fixture();
    await f.ready();
    f.controller.install();
    f.controller.receiveError("late install failure");
    expect(f.exitConfirmed).toEqual([true, false]);
    expect(f.controller.getState().errorContext).toBe("install");
});

test("install cannot run twice concurrently", async () => {
    const f = fixture();
    f.controller.install();
    expect(f.installs).toBe(0);
    await f.ready();
    f.controller.install();
    f.controller.install();
    await f.controller.retry();
    expect(f.installs).toBe(1);
    expect(f.exitConfirmed).toEqual([true]);
});

test("errors outside an operation retain readiness", async () => {
    const f = fixture();
    await f.ready();
    const before = f.controller.getState();
    const publications = f.published.length;
    f.controller.receiveError("unrelated error");
    expect(f.controller.getState()).toEqual(before);
    expect(f.published).toHaveLength(publications);
});

test("a download that settles before its completion event stays active", async () => {
    const f = fixture();
    const checking = f.controller.check();
    f.available();
    f.checks[0].resolve();
    f.downloads[0].resolve();
    await checking;
    await Promise.resolve();
    expect(f.controller.getState().status).toBe("downloading");
    await f.controller.check(true);
    expect(f.checks).toHaveLength(1);
    f.controller.receive({ type: "download-completed", version: "1.1.0" });
    expect(f.controller.getState().status).toBe("ready");
    void f.controller.check();
    expect(f.checks).toHaveLength(2);
});

test("a staging error after the download settles fails the download", async () => {
    const f = fixture();
    const checking = f.controller.check();
    f.available();
    f.checks[0].resolve();
    f.downloads[0].resolve();
    await checking;
    await Promise.resolve();
    f.controller.receiveError("Could not get code signature for running application");
    const state = f.controller.getState();
    expect(state.status).toBe("available");
    expect(state.downloadedVersion).toBeNull();
    expect(state.errorContext).toBe("download");
    expect(state.canRetry).toBe(true);
    f.controller.install();
    expect(f.installs).toBe(0);
});

test("a staging error after the download settles still lets retry download again", async () => {
    const f = fixture();
    const checking = f.controller.check();
    f.available();
    f.checks[0].resolve();
    f.downloads[0].resolve();
    await checking;
    await Promise.resolve();
    f.controller.receiveError("No space left on device");
    void f.controller.retry();
    expect(f.downloads.length).toBe(2);
    expect(f.controller.getState().status).toBe("downloading");
});
