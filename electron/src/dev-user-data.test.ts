import { expect, test } from "bun:test";
import { devUserDataPath } from "./dev-user-data";

test("defaults to the per-branch dev profile", () => {
    expect(devUserDataPath({}, "/Users/me", "main")).toBe("/Users/me/.config/taskflow-dev-main");
});
test("a blank TASKFLOW_CONFIG_DIR is ignored", () => {
    expect(devUserDataPath({ TASKFLOW_CONFIG_DIR: "  " }, "/Users/me", "main")).toBe(
        "/Users/me/.config/taskflow-dev-main",
    );
});
test("lives inside TASKFLOW_CONFIG_DIR when set", () => {
    expect(devUserDataPath({ TASKFLOW_CONFIG_DIR: "/tmp/sbx" }, "/Users/me", "main")).toBe(
        "/tmp/sbx/electron-user-data",
    );
});
test("a relative TASKFLOW_CONFIG_DIR is refused", () => {
    expect(() => devUserDataPath({ TASKFLOW_CONFIG_DIR: "sbx" }, "/Users/me", "main")).toThrow(
        "TASKFLOW_CONFIG_DIR must be an absolute path",
    );
});
