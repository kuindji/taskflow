import { describe, expect, it } from "bun:test";
import { join } from "path";
import { resolveStateDir } from "./state-dir";

describe("resolveStateDir", () => {
    it("uses TASKFLOW_TUI_STATE_DIR when set", () => {
        expect(resolveStateDir({ TASKFLOW_TUI_STATE_DIR: "/abs/state" }, "/Users/test")).toBe(
            "/abs/state",
        );
    });

    it("throws when TASKFLOW_TUI_STATE_DIR is relative", () => {
        expect(() =>
            resolveStateDir({ TASKFLOW_TUI_STATE_DIR: "relative/state" }, "/Users/test"),
        ).toThrow("TASKFLOW_TUI_STATE_DIR must be an absolute path");
    });

    it("falls back to $XDG_CONFIG_HOME/taskflow/tui", () => {
        expect(resolveStateDir({ XDG_CONFIG_HOME: "/Users/test/.xdgconfig" }, "/Users/test")).toBe(
            join("/Users/test/.xdgconfig", "taskflow", "tui"),
        );
    });

    it("falls back to <home>/.config/taskflow/tui when nothing is set", () => {
        expect(resolveStateDir({}, "/Users/test")).toBe(
            join("/Users/test", ".config", "taskflow", "tui"),
        );
    });
});
