import type { KeyEvent } from "@opentui/core";

type FocusTarget = "ui" | "session";

type UiCommand =
    | { kind: "move"; delta: -1 | 1 }
    | { kind: "open" }
    | { kind: "select-tab"; index: number }
    | { kind: "zoom" }
    | { kind: "quit" }
    | { kind: "create" }
    | { kind: "close" }
    | { kind: "resume" }
    | { kind: "flows" }
    | { kind: "schedules" }
    | { kind: "task-detail" }
    | { kind: "task-create" }
    | { kind: "git" }
    | { kind: "settings" }
    | { kind: "notifications" }
    | { kind: "filter" }
    | { kind: "help" };

type UiCommandKind = UiCommand["kind"];
type CommandGroup =
    | "General"
    | "Sessions"
    | "Tasks"
    | "Flows"
    | "Schedules"
    | "Git"
    | "Settings"
    | "Notifications";

interface CommandRouteInput {
    name: string;
    text: string;
    shift: boolean;
}

interface CommandMetadata {
    kind: UiCommandKind;
    group: CommandGroup;
    keys: string;
    hintKeys?: string;
    label: string;
    description: string;
    route(input: CommandRouteInput): UiCommand | null;
}

const exactTextRoute =
    (
        kind: Exclude<UiCommandKind, "move" | "select-tab" | "open">,
        text: string,
    ): ((input: CommandRouteInput) => UiCommand | null) =>
    (input) =>
        input.text === text ? ({ kind } as UiCommand) : null;

const COMMAND_METADATA: readonly CommandMetadata[] = [
    {
        kind: "move",
        group: "General",
        keys: "↑↓/jk",
        hintKeys: "↑↓",
        label: "Select",
        description: "Move the selected owner or item",
        route: ({ name, text, shift }) => {
            if (shift) return null;
            if (name === "down" || text === "j") return { kind: "move", delta: 1 };
            if (name === "up" || text === "k") return { kind: "move", delta: -1 };
            return null;
        },
    },
    {
        kind: "open",
        group: "General",
        keys: "Enter/l",
        hintKeys: "Enter",
        label: "Open",
        description: "Open the selected item or focus its session",
        route: ({ name, text, shift }) =>
            !shift && (name === "return" || name === "enter" || text === "l")
                ? { kind: "open" }
                : null,
    },
    {
        kind: "select-tab",
        group: "Sessions",
        keys: "1-9",
        label: "Tabs",
        description: "Select a session tab",
        route: ({ text }) =>
            text >= "1" && text <= "9"
                ? { kind: "select-tab", index: Number.parseInt(text, 10) - 1 }
                : null,
    },
    {
        kind: "zoom",
        group: "General",
        keys: "z",
        label: "Zoom",
        description: "Toggle the main pane zoom",
        route: exactTextRoute("zoom", "z"),
    },
    {
        kind: "quit",
        group: "General",
        keys: "Q",
        label: "Quit",
        description: "Quit Taskflow",
        route: exactTextRoute("quit", "Q"),
    },
    {
        kind: "create",
        group: "Sessions",
        keys: "s",
        label: "New",
        description: "Create a session for the selected owner",
        route: exactTextRoute("create", "s"),
    },
    {
        kind: "close",
        group: "Sessions",
        keys: "q",
        label: "Close",
        description: "Close the active session",
        route: exactTextRoute("close", "q"),
    },
    {
        kind: "resume",
        group: "Sessions",
        keys: "r",
        label: "Resume",
        description: "Resume an interrupted agent session",
        route: exactTextRoute("resume", "r"),
    },
    {
        kind: "task-detail",
        group: "Tasks",
        keys: "t",
        label: "Task",
        description: "Open the selected task details",
        route: exactTextRoute("task-detail", "t"),
    },
    {
        kind: "task-create",
        group: "Tasks",
        keys: "n",
        label: "New task",
        description: "Create a task or subtask",
        route: exactTextRoute("task-create", "n"),
    },
    {
        kind: "flows",
        group: "Flows",
        keys: "f",
        label: "Flows",
        description: "Open flow definitions and runs",
        route: exactTextRoute("flows", "f"),
    },
    {
        kind: "schedules",
        group: "Schedules",
        keys: "c",
        label: "Schedules",
        description: "Open schedules",
        route: exactTextRoute("schedules", "c"),
    },
    {
        kind: "git",
        group: "Git",
        keys: "g",
        label: "Git",
        description: "Open repository changes and commits",
        route: exactTextRoute("git", "g"),
    },
    {
        kind: "settings",
        group: "Settings",
        keys: ",",
        label: "Settings",
        description: "Open TUI runtime settings",
        route: exactTextRoute("settings", ","),
    },
    {
        kind: "notifications",
        group: "Notifications",
        keys: "!",
        label: "Notifications",
        description: "Open notifications",
        route: exactTextRoute("notifications", "!"),
    },
    {
        kind: "filter",
        group: "General",
        keys: "/",
        label: "Filter",
        description: "Filter projects and tasks by name",
        route: exactTextRoute("filter", "/"),
    },
    {
        kind: "help",
        group: "General",
        keys: "?",
        label: "Help",
        description: "Open this command reference",
        route: exactTextRoute("help", "?"),
    },
] as const;

function commandForUiKey(event: KeyEvent): UiCommand | null {
    if (event.eventType !== "press") return null;
    const chorded = event.ctrl || event.meta || event.option || event.super || event.hyper;
    if (chorded) return null;
    const input: CommandRouteInput = {
        name: event.name,
        text: event.sequence.length === 1 ? event.sequence : "",
        shift: event.shift,
    };
    for (const command of COMMAND_METADATA) {
        const routed = command.route(input);
        if (routed) return routed;
    }
    return null;
}

function commandHint(kind: UiCommandKind, label?: string): string {
    const command = COMMAND_METADATA.find((candidate) => candidate.kind === kind);
    if (!command) return label ?? kind;
    return `${command.hintKeys ?? command.keys} ${label ?? command.label}`;
}

type KeyRoute =
    | { kind: "pass"; before?: KeyEvent }
    | { kind: "hold-escape" }
    | { kind: "switch-focus" }
    | { kind: "command"; command: UiCommand; before?: KeyEvent }
    | { kind: "consume" };

const NAMED_PHYSICAL_KEYS: Readonly<Record<string, string>> = {
    backspace: "Backspace",
    delete: "Delete",
    down: "ArrowDown",
    end: "End",
    enter: "Enter",
    escape: "Escape",
    home: "Home",
    insert: "Insert",
    left: "ArrowLeft",
    pagedown: "PageDown",
    pageup: "PageUp",
    return: "Enter",
    right: "ArrowRight",
    space: "Space",
    tab: "Tab",
    up: "ArrowUp",
};

function isExactCtrlEscape(event: KeyEvent): boolean {
    return (
        event.source === "kitty" &&
        event.name === "escape" &&
        event.ctrl &&
        !event.meta &&
        !event.option &&
        !event.shift &&
        !event.super &&
        !event.hyper
    );
}

function isRawBareEscape(event: KeyEvent): boolean {
    return (
        event.source === "raw" &&
        event.name === "escape" &&
        !event.ctrl &&
        !event.meta &&
        !event.option &&
        !event.shift &&
        !event.super &&
        !event.hyper
    );
}

class KeyRouter {
    private heldEscape: KeyEvent | null = null;

    route(focus: FocusTarget, event: KeyEvent): KeyRoute {
        if (isExactCtrlEscape(event)) {
            if (event.eventType === "press" && event.repeated !== true) {
                this.heldEscape = null;
                return { kind: "switch-focus" };
            }
            return { kind: "consume" };
        }

        const before = this.heldEscape ?? undefined;
        this.heldEscape = null;
        if (isRawBareEscape(event) && event.eventType === "press") {
            if (before !== undefined) return { kind: "switch-focus" };
            this.heldEscape = event;
            return { kind: "hold-escape" };
        }

        if (focus === "session") return { kind: "pass", before };

        const command = commandForUiKey(event);
        if (command) return { kind: "command", command, before };
        return before ? { kind: "consume" } : { kind: "pass" };
    }

    takeHeldEscape(): KeyEvent | null {
        const held = this.heldEscape;
        this.heldEscape = null;
        return held;
    }

    clear(): void {
        this.heldEscape = null;
    }
}

/**
 * OpenTUI 0.5.7 exposes raw and Kitty escape tokens in `code`, while its
 * embedded terminal expects a physical-key name. Normalize that public event
 * shape and leave byte encoding to EmbeddedTerminalRenderable.
 */
function prepareForEmbeddedTerminal(event: KeyEvent): KeyEvent {
    const modified = event.ctrl || event.meta || event.option || event.super || event.hyper;
    const printable = Array.from(event.name).length === 1 && !modified;
    if (printable) {
        // OpenTUI already decoded the text, including Shift and the active keyboard layout.
        event.code = undefined;
        return event;
    }

    const named = NAMED_PHYSICAL_KEYS[event.name.toLowerCase()];
    if (named) event.code = named;
    else if (/^[a-z]$/i.test(event.name)) event.code = `Key${event.name.toUpperCase()}`;
    else if (/^[0-9]$/.test(event.name)) event.code = `Digit${event.name}`;
    else event.code = undefined;

    if (event.source === "kitty") event.sequence = "";
    return event;
}

export { COMMAND_METADATA, KeyRouter, commandForUiKey, commandHint, prepareForEmbeddedTerminal };
export type { CommandGroup, CommandMetadata, FocusTarget, KeyRoute, UiCommand, UiCommandKind };
