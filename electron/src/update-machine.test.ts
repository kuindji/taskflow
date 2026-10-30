import { describe, expect, it } from "bun:test";
import type { DesktopUpdateEvent, DesktopUpdateState } from "@taskflow/shared";
import { createInitialDesktopUpdateState, reduceDesktopUpdateState } from "./update-machine";

const checkedAt = "2026-03-04T00:00:00.000Z";
function ready(): DesktopUpdateState {
    return {
        ...createInitialDesktopUpdateState(),
        status: "ready",
        availableVersion: "1.1.0",
        downloadedVersion: "1.1.0",
        downloadPercent: 100,
        canRetry: true,
    };
}

// Adapted from t3code (MIT, https://github.com/pingdotgg/t3code, 32ecd717): apps/desktop/src/updates/updateMachine.test.ts
describe("update machine", () => {
    it("preserves an already-downloaded update while checking the feed", () => {
        const checking = reduceDesktopUpdateState(ready(), { type: "check-started", checkedAt });
        const failed = reduceDesktopUpdateState(checking, {
            type: "check-failed",
            checkedAt,
            message: "network unavailable",
        });
        expect(checking.status).toBe("checking");
        expect(checking.downloadedVersion).toBe("1.1.0");
        expect(checking.downloadPercent).toBe(100);
        expect(checking.checkedAt).toBe(checkedAt);
        expect(failed.status).toBe("ready");
        expect(failed.downloadedVersion).toBe("1.1.0");
        expect(failed.message).toBeNull();
    });
    it("preserves available version on download failure for retry", () => {
        const state = reduceDesktopUpdateState(
            {
                ...createInitialDesktopUpdateState(),
                status: "downloading",
                availableVersion: "1.1.0",
                downloadPercent: 43,
            },
            { type: "download-failed", message: "checksum mismatch" },
        );
        expect(state.status).toBe("available");
        expect(state.availableVersion).toBe("1.1.0");
        expect(state.errorContext).toBe("download");
        expect(state.message).toBe("checksum mismatch");
        expect(state.canRetry).toBe(true);
    });
    it("transitions to ready and then preserves install retry state", () => {
        const downloaded = reduceDesktopUpdateState(
            {
                ...createInitialDesktopUpdateState(),
                status: "downloading",
                availableVersion: "1.1.0",
            },
            { type: "download-completed", version: "1.1.0" },
        );
        const installing = reduceDesktopUpdateState(downloaded, { type: "install-started" });
        const failed = reduceDesktopUpdateState(installing, {
            type: "install-failed",
            message: "backend shutdown timed out",
        });
        expect(downloaded.status).toBe("ready");
        expect(downloaded.downloadedVersion).toBe("1.1.0");
        expect(installing.status).toBe("installing");
        expect(installing.canRetry).toBe(false);
        expect(failed.status).toBe("ready");
        expect(failed.downloadedVersion).toBe("1.1.0");
        expect(failed.errorContext).toBe("install");
        expect(failed.canRetry).toBe(true);
    });
    it("clears stale available state when no update is available", () => {
        const state = reduceDesktopUpdateState(
            {
                ...createInitialDesktopUpdateState(),
                status: "error",
                availableVersion: "1.1.0",
                message: "old failure",
                errorContext: "download",
                canRetry: true,
            },
            { type: "no-update", checkedAt },
        );
        expect(state.status).toBe("idle");
        expect(state.availableVersion).toBeNull();
        expect(state.downloadedVersion).toBeNull();
        expect(state.downloadPercent).toBeNull();
        expect(state.message).toBeNull();
        expect(state.errorContext).toBeNull();
        expect(state.canRetry).toBe(false);
    });
    it("failed check keeps a downloaded update ready", () => {
        const state = reduceDesktopUpdateState(ready(), {
            type: "check-failed",
            checkedAt,
            message: "offline",
        });
        expect(state).toEqual({ ...ready(), checkedAt });
        const failed = reduceDesktopUpdateState(createInitialDesktopUpdateState(), {
            type: "check-failed",
            checkedAt,
            message: "offline",
        });
        expect(failed).toMatchObject({
            status: "error",
            errorContext: "check",
            message: "offline",
            canRetry: true,
            checkedAt,
        });
    });
    it("no-update keeps a downloaded update ready", () => {
        const state = reduceDesktopUpdateState(ready(), { type: "no-update", checkedAt });
        expect(state).toEqual({ ...ready(), checkedAt });
    });
    it("a different available version clears stale downloaded readiness", () => {
        expect(
            reduceDesktopUpdateState(ready(), {
                type: "update-available",
                version: "1.2.0",
                checkedAt,
            }),
        ).toMatchObject({
            status: "available",
            availableVersion: "1.2.0",
            downloadedVersion: null,
            downloadPercent: null,
            message: null,
            errorContext: null,
            canRetry: false,
        });
        expect(
            reduceDesktopUpdateState(ready(), {
                type: "update-available",
                version: "1.1.0",
                checkedAt,
            }),
        ).toEqual({ ...ready(), checkedAt });
    });
    it("install without a downloaded update is ignored", () => {
        const initial = createInitialDesktopUpdateState();
        expect(initial).toEqual({
            status: "idle",
            availableVersion: null,
            downloadedVersion: null,
            downloadPercent: null,
            checkedAt: null,
            message: null,
            errorContext: null,
            canRetry: false,
        });
        expect(reduceDesktopUpdateState(initial, { type: "install-started" })).toEqual(initial);
    });
    it("the reducer leaves its input unchanged", () => {
        const input = Object.freeze(ready());
        const before = { ...input };
        const events: DesktopUpdateEvent[] = [
            { type: "check-started", checkedAt },
            { type: "check-failed", checkedAt, message: "offline" },
            { type: "update-available", version: "1.2.0", checkedAt },
            { type: "no-update", checkedAt },
            { type: "download-started" },
            { type: "download-progress", percent: 43 },
            { type: "download-completed", version: "1.2.0" },
            { type: "download-failed", message: "checksum" },
            { type: "install-started" },
            { type: "install-failed", message: "shutdown" },
        ];
        for (const event of events) {
            reduceDesktopUpdateState(input, event);
            expect(input).toEqual(before);
        }
    });
});
