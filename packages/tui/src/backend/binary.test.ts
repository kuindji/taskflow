import { describe, expect, it } from "bun:test";
import { resolveBackendBinary } from "./binary";

const TUI = "/home/me/.local/bin/taskflow-tui";
const SIBLING = "/home/me/.local/bin/taskflow-backend";

describe("resolveBackendBinary", () => {
    it("uses TASKFLOW_BACKEND_BIN when it is set", () => {
        const env = { TASKFLOW_BACKEND_BIN: "/opt/taskflow-backend" };
        expect(resolveBackendBinary(env, TUI, "linux", () => true)).toBe("/opt/taskflow-backend");
    });

    it("ignores an empty TASKFLOW_BACKEND_BIN", () => {
        const env = { TASKFLOW_BACKEND_BIN: "" };
        expect(resolveBackendBinary(env, TUI, "linux", () => true)).toBe(SIBLING);
    });

    it("prefers the backend installed beside the TUI binary", () => {
        expect(resolveBackendBinary({}, TUI, "linux", (path) => path === SIBLING)).toBe(SIBLING);
    });

    it("falls back to taskflow-backend on PATH", () => {
        expect(resolveBackendBinary({}, TUI, "linux", () => false)).toBe("taskflow-backend");
    });

    it("looks for the .exe name on Windows", () => {
        const tui = "C:\\taskflow\\taskflow-tui.exe";
        expect(resolveBackendBinary({}, tui, "win32", () => false)).toBe("taskflow-backend.exe");
    });
});
