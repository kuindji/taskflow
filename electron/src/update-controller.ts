import type { DesktopUpdateEvent, DesktopUpdateState } from "@taskflow/shared";
import { createInitialDesktopUpdateState, reduceDesktopUpdateState } from "./update-machine";

export interface UpdateController {
    getState(): DesktopUpdateState;
    check(manual?: boolean): Promise<void>;
    install(): void;
    retry(): Promise<void>;
    receive(event: DesktopUpdateEvent): void;
    receiveError(message: string): void;
}

export interface UpdateControllerDeps {
    checkForUpdates(): Promise<unknown>;
    downloadUpdate(): Promise<unknown>;
    quitAndInstall(): void;
    publish(state: DesktopUpdateState): void;
    setExitConfirmed(value: boolean): void;
    now(): string;
    showNoUpdate(): void;
    showCheckFailure(message: string): void;
}

interface Operation {
    phase: "check" | "download" | "install";
    failed: boolean;
    outcomeReceived: boolean;
    settled: boolean;
    manual: boolean;
}

export function createUpdateController(deps: UpdateControllerDeps): UpdateController {
    let state = createInitialDesktopUpdateState();
    let active: Operation | null = null;

    function dispatch(event: DesktopUpdateEvent): void {
        state = reduceDesktopUpdateState(state, event);
        deps.publish(state);
    }

    function begin(phase: Operation["phase"], manual = false): Operation {
        const operation: Operation = {
            phase,
            failed: false,
            outcomeReceived: false,
            settled: false,
            manual,
        };
        active = operation;
        return operation;
    }

    function fail(operation: Operation, message: string): void {
        if (operation.failed || operation.outcomeReceived) return;
        operation.failed = true;
        switch (operation.phase) {
            case "check":
                dispatch({ type: "check-failed", checkedAt: deps.now(), message });
                if (operation.manual) deps.showCheckFailure(message);
                operation.manual = false;
                break;
            case "download":
                dispatch({ type: "download-failed", message });
                break;
            case "install":
                deps.setExitConfirmed(false);
                dispatch({ type: "install-failed", message });
                if (active === operation) active = null;
                break;
        }
        // A macOS staging error arrives after the download promise settled.
        release(operation);
    }

    // An available-update event can already have started a download, so only
    // the active operation is released. Failed operations are kept until
    // settlement to deduplicate error + rejection. A download also waits for
    // its outcome: on macOS the promise settles before Squirrel has staged the
    // update, and a staging error must still fail the download.
    function release(operation: Operation): void {
        if (active !== operation || !operation.settled) return;
        if (operation.phase === "download" && !operation.failed && !operation.outcomeReceived)
            return;
        active = null;
    }

    async function run(operation: Operation, action: () => Promise<unknown>): Promise<void> {
        try {
            await action();
        } catch (error) {
            fail(operation, error instanceof Error ? error.message : String(error));
        } finally {
            operation.settled = true;
            release(operation);
        }
    }

    function download(): Promise<void> {
        const operation = begin("download");
        dispatch({ type: "download-started" });
        return run(operation, () => deps.downloadUpdate());
    }

    function check(manual = false): Promise<void> {
        if (active) return Promise.resolve();
        const operation = begin("check", manual);
        dispatch({ type: "check-started", checkedAt: deps.now() });
        return run(operation, () => deps.checkForUpdates());
    }

    function install(): void {
        if (active || state.downloadedVersion === null || state.status !== "ready") return;
        const operation = begin("install");
        dispatch({ type: "install-started" });
        try {
            deps.setExitConfirmed(true);
            deps.quitAndInstall();
        } catch (error) {
            fail(operation, error instanceof Error ? error.message : String(error));
        }
    }

    function retry(): Promise<void> {
        if (active || !state.canRetry) return Promise.resolve();
        switch (state.errorContext) {
            case "download":
                return state.availableVersion !== null ? download() : Promise.resolve();
            case "install":
                install();
                return Promise.resolve();
            default:
                return check(true);
        }
    }

    function receive(event: DesktopUpdateEvent): void {
        const operation = active;
        if (!operation || operation.failed || operation.outcomeReceived) return;
        switch (event.type) {
            case "update-available":
            case "no-update":
                if (operation.phase !== "check") return;
                operation.outcomeReceived = true;
                dispatch(event);
                if (event.type === "no-update" && operation.manual) deps.showNoUpdate();
                operation.manual = false;
                if (
                    event.type === "update-available" &&
                    state.downloadedVersion !== event.version
                ) {
                    void download();
                }
                break;
            case "download-progress":
            case "download-completed":
                if (operation.phase !== "download") return;
                if (event.type === "download-completed") operation.outcomeReceived = true;
                dispatch(event);
                release(operation);
                break;
        }
    }

    return {
        getState: () => ({ ...state }),
        check,
        install,
        retry,
        receive,
        receiveError(message) {
            if (active) fail(active, message);
            else console.warn("[updater] Error outside an active operation:", message);
        },
    };
}
