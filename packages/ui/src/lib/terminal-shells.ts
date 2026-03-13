import { DEFAULT_TERMINAL_SHELL, type ShellInfo } from "@taskflow/shared";

function titleCaseShellName(name: string): string {
    return name.charAt(0).toUpperCase() + name.slice(1);
}

export function getShellDisplayName(shell: Pick<ShellInfo, "name">): string {
    return titleCaseShellName(shell.name);
}

export function getShellSessionLabel(path: string): string {
    return path.split("/").pop() ?? "shell";
}

export function getShellNameFromPath(path: string): string {
    const shellName = getShellSessionLabel(path);
    return titleCaseShellName(shellName);
}

export function isConfiguredShellAvailable(shells: ShellInfo[], configuredShell: string): boolean {
    if (configuredShell === DEFAULT_TERMINAL_SHELL) return true;
    return shells.some((shell) => shell.path === configuredShell);
}

export function resolveTerminalShellPath(
    shells: ShellInfo[],
    systemShellPath: string | null,
    configuredShell: string,
): string | null {
    if (configuredShell !== DEFAULT_TERMINAL_SHELL) {
        const configured = shells.find((shell) => shell.path === configuredShell);
        if (configured) return configured.path;
    }

    if (systemShellPath) {
        const systemShell = shells.find((shell) => shell.path === systemShellPath);
        if (systemShell) return systemShell.path;
    }

    return shells[0]?.path ?? null;
}

export function getTerminalShellSummary(
    shells: ShellInfo[],
    systemShellPath: string | null,
    configuredShell: string,
): string {
    if (configuredShell === DEFAULT_TERMINAL_SHELL) {
        if (!systemShellPath) return "System Default";
        return `System Default (${getShellNameFromPath(systemShellPath)})`;
    }

    const configured = shells.find((shell) => shell.path === configuredShell);
    if (configured) return getShellDisplayName(configured);

    return `Unavailable (${getShellNameFromPath(configuredShell)})`;
}
