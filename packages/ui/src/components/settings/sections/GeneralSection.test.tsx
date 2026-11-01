import { afterEach, expect, test } from "bun:test";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { TooltipProvider } from "@/components/ui/tooltip";
import { GeneralSection } from "./GeneralSection";
// @ts-expect-error react act env flag
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const original = window.taskflow;
const cleanups: (() => void)[] = [];
afterEach(() => {
    cleanups.splice(0).forEach((fn) => fn());
    window.taskflow = original;
});
async function mount(showAccessToken: boolean) {
    window.taskflow = { getLocalApiToken: async () => "abcdef" + "a".repeat(37) } as NonNullable<
        Window["taskflow"]
    >;
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const noop = () => {};
    await act(async () => {
        root.render(
            <TooltipProvider>
                <GeneralSection
                    dataDirInfo={null}
                    migrating={false}
                    migrationError={null}
                    dataDirDisabledReason={null}
                    showAccessToken={showAccessToken}
                    confirmBeforeExit={false}
                    discoverable={false}
                    displayName=""
                    hostname="host"
                    onChangeDataDir={noop}
                    onResetDataDir={noop}
                    onConfirmBeforeExitChange={noop}
                    onDiscoverableChange={noop}
                    onDisplayNameChange={noop}
                />
            </TooltipProvider>,
        );
        await Promise.resolve();
    });
    cleanups.push(() => {
        act(() => root.unmount());
        container.remove();
    });
    return container;
}
test("offers this machine's access token only with this machine's settings", async () => {
    expect((await mount(true)).textContent).toContain("Access token");
    // Primary is another machine: this machine's token would not open it.
    expect((await mount(false)).textContent).not.toContain("Access token");
});
