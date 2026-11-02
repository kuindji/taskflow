import { BACKEND_RESTART_EXIT_CODE } from "@taskflow/shared";

/**
 * Calls `onRestart` when the backend exits asking to be restarted (after a data
 * folder change). A kill, crash or normal exit does not count.
 */
export function watchBackendRestart(
    backend: { once(event: "exit", listener: (code: number | null) => void): unknown },
    onRestart: () => void,
): void {
    backend.once("exit", (code) => {
        if (code === BACKEND_RESTART_EXIT_CODE) onRestart();
    });
}
