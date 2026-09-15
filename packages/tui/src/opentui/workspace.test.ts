import { afterEach, describe, expect, it } from "bun:test";
import { createTestRenderer } from "@opentui/core/testing";
import { CliRenderEvents } from "@opentui/core";
import type { FlowDefinition, Task } from "@taskflow/shared";
import { MSG } from "@taskflow/shared";
import { Store } from "../state/store";
import { FlowStore } from "../flows/store";
import { ScheduleStore } from "../schedules/store";
import { TaskDetailStore } from "../tasks/store";
import { GitStore } from "../git/store";
import { SettingsStore } from "../settings/store";
import { NotificationStore } from "../notifications/store";
import { SessionController } from "../sessions/controller";
import { OpenTuiApp } from "./app";
import { FakeNet, fullSettings, project, task } from "./test-helpers";
import { openWorkspace, type Workspace } from "./workspace";

type TestSetup = Awaited<ReturnType<typeof createTestRenderer>>;

function workspaceNet(): FakeNet {
    const net = new FakeNet();
    net.responses.set(MSG.PROJECT_LIST, { projects: [project("p1", "Project")] });
    net.responses.set(MSG.TASK_LIST, { tasks: [task("t1", "p1", "Task")] });
    net.responses.set(MSG.MASTER_SESSIONS_LIST, { sessions: [] });
    net.responses.set(MSG.SYSTEM_INFO, {
        editors: [{ id: "true", name: "True", command: "true", type: "internal" }],
        homedir: "/tmp",
        schedulerEnabled: true,
        hostname: "test",
    });
    net.responses.set(MSG.SETTINGS_GET, fullSettings());
    net.responses.set(MSG.FLOW_DEFINITIONS_LIST, { flows: [] });
    net.responses.set(MSG.FLOW_ACTIONS_LIST, { actions: [] });
    net.responses.set(MSG.FLOW_RUNS_LIST, { runs: [] });
    net.responses.set(MSG.SCHEDULE_LIST, { schedules: [] });
    net.responses.set(MSG.NOTIFICATION_LIST, { notifications: [] });
    return net;
}

async function waitFor(condition: () => boolean): Promise<void> {
    for (let attempt = 0; attempt < 400; attempt++) {
        if (condition()) return;
        await Bun.sleep(5);
    }
    throw new Error("Timed out waiting for condition");
}

describe("openWorkspace", () => {
    const cleanups: Array<() => void> = [];
    afterEach(() => {
        for (const cleanup of cleanups.splice(0).reverse()) cleanup();
    });

    async function renderer(): Promise<TestSetup> {
        const test = await createTestRenderer({ width: 100, height: 24, kittyKeyboard: true });
        cleanups.push(() => test.renderer.destroy());
        return test;
    }

    async function open(test: TestSetup, net = workspaceNet()): Promise<Workspace> {
        const workspace = await openWorkspace(net, {
            renderer: test.renderer,
            machineId: "local",
            machineLabel: "This machine",
            local: true,
            onQuit: () => undefined,
            onSwitchMachine: () => undefined,
        });
        cleanups.push(() => workspace.dispose());
        return workspace;
    }

    it("disposes the app first, then the controller, then every store, exactly once", async () => {
        const log: string[] = [];
        // Patch prototypes by hand: the original must be read before the method
        // is replaced, or the wrapper ends up calling itself.
        function trace<K extends "destroy" | "dispose">(
            prototype: Record<K, () => void>,
            key: K,
            label: string,
        ): void {
            const original = prototype[key];
            prototype[key] = function (this: unknown): void {
                log.push(label);
                original.call(this);
            };
            cleanups.push(() => {
                prototype[key] = original;
            });
        }
        trace(OpenTuiApp.prototype, "destroy", "app");
        trace(SessionController.prototype, "destroy", "controller");
        trace(Store.prototype, "dispose", "store");
        trace(FlowStore.prototype, "dispose", "flows");
        trace(ScheduleStore.prototype, "dispose", "schedules");
        trace(TaskDetailStore.prototype, "dispose", "tasks");
        trace(GitStore.prototype, "dispose", "git");
        trace(SettingsStore.prototype, "dispose", "settings");
        trace(NotificationStore.prototype, "dispose", "notifications");

        const test = await renderer();
        const net = workspaceNet();
        const workspace = await open(test, net);
        const requestsBefore = net.requests.length;

        workspace.dispose();
        await Bun.sleep(0);

        expect(log).toEqual([
            "app",
            "controller",
            "store",
            "flows",
            "schedules",
            "tasks",
            "git",
            "settings",
            "notifications",
        ]);
        expect(net.requests.slice(requestsBefore)).toEqual([]);
        expect(net.requests.some((request) => request.type === MSG.SESSION_CLOSE)).toBe(false);

        workspace.dispose();
        expect(log).toHaveLength(9);
    });

    it("rebuilds on the same renderer without leaving the old workspace attached", async () => {
        const test = await renderer();
        const keypressBase = test.renderer.keyInput.listenerCount("keypress");
        const resizeBase = test.renderer.listenerCount(CliRenderEvents.RESIZE);

        const first = await open(test);
        first.dispose();
        const second = await open(test);

        expect(test.renderer.keyInput.listenerCount("keypress")).toBe(keypressBase + 1);
        expect(test.renderer.listenerCount(CliRenderEvents.RESIZE)).toBe(resizeBase + 1);
        expect(test.renderer.root.getChildren()).not.toContain(first.app.root);
        expect(test.renderer.root.getChildren()).toContain(second.app.root);

        test.mockInput.pressArrow("down");
        expect(second.app.selectedIndex).toBe(1);
        expect(first.app.selectedIndex).toBe(0);
    });

    it("reports an open editor while a task text edit is pending", async () => {
        const test = await renderer();
        const net = workspaceNet();
        const save = Promise.withResolvers<Task>();
        net.responses.set(MSG.TASK_UPDATE, save.promise);
        const workspace = await open(test, net);

        test.mockInput.pressArrow("down");
        test.mockInput.pressArrow("down");
        test.mockInput.pressKey("t");
        await Bun.sleep(0);
        test.mockInput.pressKey("e");
        await Bun.sleep(0);
        expect(workspace.hasOpenEditor()).toBe(false);
        test.mockInput.pressEnter();

        await waitFor(() => net.requests.some((request) => request.type === MSG.TASK_UPDATE));
        expect(workspace.hasOpenEditor()).toBe(true);

        save.resolve(task("t1", "p1", "Task"));
        await waitFor(() => !workspace.hasOpenEditor());
    });

    it("reports an open editor while a record edit is pending", async () => {
        const test = await renderer();
        const net = workspaceNet();
        const save = Promise.withResolvers<FlowDefinition>();
        net.responses.set(MSG.FLOW_DEFINITION_SAVE, save.promise);
        const workspace = await open(test, net);

        test.mockInput.pressKey("f");
        test.mockInput.pressKey("n");
        await Bun.sleep(0);
        expect(workspace.hasOpenEditor()).toBe(false);
        test.mockInput.pressEnter();

        await waitFor(() =>
            net.requests.some((request) => request.type === MSG.FLOW_DEFINITION_SAVE),
        );
        expect(workspace.hasOpenEditor()).toBe(true);

        save.resolve({
            id: "f1",
            name: "New flow",
            description: "",
            actions: [],
            createdAt: "now",
            updatedAt: "now",
        });
        await waitFor(() => !workspace.hasOpenEditor());
    });

    it("round-trips the selection and ignores owners the store no longer has", async () => {
        const test = await renderer();
        const workspace = await open(test);

        expect(workspace.selection()).toEqual({ projectId: null, taskId: null });
        workspace.restoreSelection({ projectId: "p1", taskId: "t1" });
        expect(workspace.selection()).toEqual({ projectId: "p1", taskId: "t1" });
        workspace.restoreSelection({ projectId: "p1", taskId: null });
        expect(workspace.selection()).toEqual({ projectId: "p1", taskId: null });

        workspace.restoreSelection({ projectId: "gone", taskId: "gone" });
        expect(workspace.selection()).toEqual({ projectId: "p1", taskId: null });
    });
});
