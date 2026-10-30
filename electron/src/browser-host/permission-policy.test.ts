import { expect, test } from "bun:test";
import { isNavigableScheme, isPermissionAllowed } from "./permission-policy";

test("allows exactly the four allowlisted permissions", () => {
    for (const permission of [
        "clipboard-sanitized-write",
        "storage-access",
        "top-level-storage-access",
        "persistent-storage",
    ]) {
        expect(isPermissionAllowed(permission)).toBe(true);
    }
    for (const permission of [
        "",
        "unknown",
        "display-capture",
        "midi",
        "pointerLock",
        "keyboardLock",
        "fullscreen",
        "window-management",
        "idle-detection",
        "hid",
        "serial",
        "usb",
    ]) {
        expect(isPermissionAllowed(permission)).toBe(false);
    }
});

test("denies media, geolocation, notifications, clipboard-read and openExternal", () => {
    for (const permission of [
        "media",
        "geolocation",
        "notifications",
        "clipboard-read",
        "openExternal",
    ]) {
        expect(isPermissionAllowed(permission)).toBe(false);
    }
});

test("navigable schemes are http, https, about, data and blob; mailto and vscode are not", () => {
    for (const url of [
        "http://example.com",
        "https://example.com",
        "about:blank",
        "data:text/html,hi",
        "blob:https://example.com/id",
    ])
        expect(isNavigableScheme(url)).toBe(true);
    for (const url of [
        "mailto:a@example.com",
        "vscode://file/test",
        "file:///tmp/file",
        "javascript:alert(1)",
        "invalid",
    ])
        expect(isNavigableScheme(url)).toBe(false);
});
