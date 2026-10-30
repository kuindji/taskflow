const allowedPermissions = new Set([
    "clipboard-sanitized-write",
    "storage-access",
    "top-level-storage-access",
    "persistent-storage",
]);
const navigableSchemes = new Set(["http:", "https:", "about:", "data:", "blob:"]);

export function isPermissionAllowed(permission: string): boolean {
    return allowedPermissions.has(permission);
}

export function isNavigableScheme(url: string): boolean {
    try {
        return navigableSchemes.has(new URL(url).protocol);
    } catch {
        return false;
    }
}
