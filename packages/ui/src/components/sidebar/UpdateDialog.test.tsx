import { afterEach, expect, test } from "bun:test";
import { act } from "react";
import { createRoot } from "react-dom/client";
import type { DesktopUpdateState } from "@taskflow/shared";
import { UpdateDialog } from "./UpdateDialog";

// @ts-expect-error React act environment flag
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const cleanups: (() => void)[] = [];
afterEach(() => {
    cleanups.splice(0).forEach((cleanup) => cleanup());
});
const ready: DesktopUpdateState = {
    status: "ready",
    availableVersion: "1.1.0",
    downloadedVersion: "1.1.0",
    downloadPercent: 100,
    checkedAt: null,
    message: null,
    errorContext: null,
    canRetry: true,
};
function mount(state: DesktopUpdateState) {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    let installs = 0;
    let retries = 0;
    act(() =>
        root.render(
            <UpdateDialog
                updateStatus={state}
                dialogOpen
                onDialogOpenChange={() => {}}
                onInstall={() => {
                    installs++;
                }}
                onRetry={() => {
                    retries++;
                }}
            />,
        ),
    );
    cleanups.push(() => {
        act(() => root.unmount());
        container.remove();
    });
    const dialog = document.querySelector<HTMLElement>('[role="alertdialog"]');
    if (!dialog) throw new Error("Update dialog did not mount");
    const button = (label: string) =>
        Array.from(dialog.querySelectorAll("button")).find((b) => b.textContent === label);
    const click = (label: string) => {
        const target = button(label);
        if (!target) throw new Error(`Missing ${label} button`);
        act(() => target.click());
    };
    return {
        dialog,
        button,
        click,
        get installs() {
            return installs;
        },
        get retries() {
            return retries;
        },
    };
}

test("ready renders Restart Now with the downloaded version", () => {
    const f = mount({ ...ready, availableVersion: "1.2.0" });
    expect(f.dialog.textContent).toContain("Update Available");
    expect(f.dialog.textContent).toContain(
        "Taskflow v1.1.0 is ready to install. The app will restart to apply the update.",
    );
    expect(f.button("Later")).toBeDefined();
    f.click("Restart Now");
    expect(f.installs).toBe(1);
    expect(f.retries).toBe(0);
});

test("check failure offers Retry", () => {
    const f = mount({
        ...ready,
        status: "error",
        availableVersion: null,
        downloadedVersion: null,
        downloadPercent: null,
        errorContext: "check",
        message: "feed unavailable",
    });
    expect(f.dialog.textContent).toContain("Update Check Failed");
    expect(f.dialog.textContent).toContain("feed unavailable");
    expect(f.button("Restart Now")).toBeUndefined();
    f.click("Retry");
    expect(f.retries).toBe(1);
    expect(f.installs).toBe(0);
});

test("download failure says Update Download Failed", () => {
    const f = mount({
        ...ready,
        status: "available",
        downloadedVersion: null,
        downloadPercent: null,
        errorContext: "download",
        message: "checksum mismatch",
    });
    expect(f.dialog.textContent).toContain("Update Download Failed");
    expect(f.dialog.textContent).toContain("checksum mismatch");
    expect(f.button("Restart Now")).toBeUndefined();
    f.click("Retry");
    expect(f.retries).toBe(1);
    expect(f.installs).toBe(0);
});

test("install failure retains the version and retries installation", () => {
    const f = mount({ ...ready, errorContext: "install", message: "shutdown failed" });
    expect(f.dialog.textContent).toContain("Update Installation Failed");
    expect(f.dialog.textContent).toContain("shutdown failed");
    expect(f.dialog.textContent).toContain("Taskflow v1.1.0 is still ready to install.");
    expect(f.button("Restart Now")).toBeUndefined();
    f.click("Retry");
    expect(f.installs).toBe(1);
    expect(f.retries).toBe(0);
});

test("installing disables duplicate actions", () => {
    const f = mount({ ...ready, status: "installing", canRetry: false });
    expect(f.dialog.textContent).toContain("Installing update...");
    for (const button of f.dialog.querySelectorAll<HTMLButtonElement>(
        'button[data-slot="alert-dialog-action"]',
    )) {
        expect(button.disabled).toBe(true);
        act(() => button.click());
    }
    expect(f.button("Restart Now")?.disabled ?? true).toBe(true);
    expect(f.button("Retry")?.disabled ?? true).toBe(true);
    expect(f.installs).toBe(0);
    expect(f.retries).toBe(0);
});
