/**
 * A launch option left unset ("default"), so the backend fills it from the
 * running machine's Settings.
 */
type Inheritable<T> = T | "default";

/**
 * Label of the choice that leaves a launch option unset.
 *
 * `settingValue` is the Settings value it will launch with, shown as text;
 * null when Settings leaves the option to the agent CLI as well (also for
 * headless runs, which ignore Settings); undefined while Settings load.
 */
function launchDefaultLabel(agent: string, settingValue: string | null | undefined): string {
    if (settingValue === undefined) return "Default (from Settings)";
    if (settingValue === null) return `Default (${agent} CLI default)`;
    return `Default (${settingValue}, from Settings)`;
}

function isChosen<T>(value: Inheritable<T>): value is T {
    return value !== "default";
}

/**
 * Wraps a Settings-page setter for a shared options control. The Settings page
 * never offers "default" for these fields (nothing sits above Settings).
 */
function settingsSetter<T>(set: (value: T) => void): (value: Inheritable<T>) => void {
    return (value) => {
        if (isChosen(value)) set(value);
    };
}

function capitalize(value: string): string {
    return value.charAt(0).toUpperCase() + value.slice(1);
}

export { capitalize, launchDefaultLabel, settingsSetter };
export type { Inheritable };
