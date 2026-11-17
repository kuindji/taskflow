import { expect, test } from "bun:test";
import { createLastPathTracker } from "./dialog-last-path";

test("no default path before anything is picked", () => {
    expect(createLastPathTracker().defaultPath()).toBeUndefined();
});
test("a picked directory becomes the default", () => {
    const t = createLastPathTracker();
    t.remember("/Users/me/Projects/app", "directory");
    expect(t.defaultPath()).toBe("/Users/me/Projects/app");
});
test("a picked file makes its parent directory the default", () => {
    const t = createLastPathTracker();
    t.remember("/Users/me/themes/dark.json", "file");
    expect(t.defaultPath()).toBe("/Users/me/themes");
});
