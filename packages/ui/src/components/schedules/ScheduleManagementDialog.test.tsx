import { afterEach, expect, test } from "bun:test";
import { act } from "react";
import { createRoot } from "react-dom/client";
import type { Schedule } from "@taskflow/shared";
import { setPrimary } from "@/lib/connection-registry";
import { useScheduleStore } from "@/stores/schedule-store";
import { useFlowStore } from "@/stores/flow-store";
import { useUIStore } from "@/stores/ui-store";
import { ScheduleManagementDialog } from "./ScheduleManagementDialog";

// @ts-expect-error react act env flag, no upstream type for this global
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

type Bridge = NonNullable<Window["taskflow"]>;

const originalBridge = window.taskflow;
const cleanups: (() => void)[] = [];

afterEach(() => {
    for (const cleanup of cleanups.splice(0)) cleanup();
    window.taskflow = originalBridge;
});

const disabled: Schedule = {
    id: "s1",
    projectId: "p1",
    name: "Nightly",
    prompt: "run it",
    expression: "rate(30 minutes)",
    expressionType: "rate",
    enabled: false,
    timeout: 30,
    lastRunAt: null,
    lastError: null,
    nextRunAt: null,
    runningSessionId: null,
    createdAt: "",
    updatedAt: "",
};

test("Run now on a disabled schedule shows the backend's refusal", async () => {
    // The native menu picks "Run now" as soon as it opens.
    const bridge: Pick<Bridge, "showNativeMenu"> = {
        showNativeMenu: () => Promise.resolve("run-now"),
    };
    window.taskflow = bridge as Bridge;
    setPrimary("b1");
    const scheduleState = useScheduleStore.getState();
    const { fetchActions } = useFlowStore.getState();
    cleanups.push(() => {
        useScheduleStore.setState(scheduleState, true);
        useFlowStore.setState({ fetchActions });
    });
    useScheduleStore.setState({
        schedules: [{ ...disabled, backendId: "b1" }],
        fetchSchedules: () => Promise.resolve(),
        triggerSchedule: () => Promise.reject(new Error("Schedule is disabled")),
    });
    useFlowStore.setState({ fetchActions: () => Promise.resolve() });
    useUIStore.setState({ scheduleManagementOpen: true });

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => {
        root.render(<ScheduleManagementDialog />);
        await Bun.sleep(10);
    });
    cleanups.push(() => {
        act(() => root.unmount());
        container.remove();
        useUIStore.setState({ scheduleManagementOpen: false });
    });

    const menu = document.querySelector<HTMLButtonElement>("button[title='Actions']");
    if (!menu) throw new Error("no actions menu");
    await act(async () => {
        menu.click();
        await Bun.sleep(10);
    });

    expect(document.querySelector("[role='alert']")?.textContent).toContain(
        'Run now failed for "Nightly": Schedule is disabled',
    );
});
