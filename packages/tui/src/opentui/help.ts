import { ScrollBoxRenderable, TextRenderable, type CliRenderer, type KeyEvent } from "@opentui/core";
import { COMMAND_METADATA, type CommandGroup, type CommandMetadata } from "./keys";

interface HelpDeps {
    renderer: CliRenderer;
    commands?: readonly CommandMetadata[];
    onClose(): void;
    onStateChange?(): void;
}

const GROUP_ORDER: readonly CommandGroup[] = [
    "General",
    "Sessions",
    "Tasks",
    "Flows",
    "Schedules",
    "Git",
    "Settings",
    "Notifications",
];

class Help {
    readonly renderable: ScrollBoxRenderable;
    private readonly commands: readonly CommandMetadata[];

    constructor(private readonly deps: HelpDeps) {
        this.commands = deps.commands ?? COMMAND_METADATA;
        this.renderable = new ScrollBoxRenderable(deps.renderer, {
            id: "help-overlay",
            position: "absolute",
            width: "100%",
            height: "100%",
            zIndex: 100,
            scrollY: true,
            scrollX: false,
            backgroundColor: "#000000",
            onMouseDown: (event) => {
                event.preventDefault();
                event.stopPropagation();
            },
            onMouseScroll: (event) => {
                const direction = event.scroll?.direction;
                if (direction !== "up" && direction !== "down") return;
                event.preventDefault();
                event.stopPropagation();
                this.renderable.scrollBy(direction === "up" ? -3 : 3);
                this.deps.onStateChange?.();
            },
        });
        this.rebuild();
    }

    get keyHints(): string {
        return " ↑↓/PgUp/PgDn Scroll  Esc/q Close help";
    }

    handleKey(event: KeyEvent): void {
        if (event.eventType !== "press") return;
        const chorded = event.ctrl || event.meta || event.option || event.super || event.hyper;
        if (chorded) return;
        if (event.name === "escape" || event.sequence === "q") return this.deps.onClose();
        if (event.name === "down" || event.sequence === "j") this.renderable.scrollBy(1);
        else if (event.name === "up" || event.sequence === "k") this.renderable.scrollBy(-1);
        else if (event.name === "pagedown") this.renderable.scrollBy(8);
        else if (event.name === "pageup") this.renderable.scrollBy(-8);
        else return;
        this.deps.onStateChange?.();
    }

    private rebuild(): void {
        this.renderable.add(
            new TextRenderable(this.deps.renderer, {
                content: " Taskflow keyboard help",
                height: 1,
            }),
        );
        for (const group of GROUP_ORDER) {
            const commands = this.commands.filter((command) => command.group === group);
            if (commands.length === 0) continue;
            this.renderable.add(
                new TextRenderable(this.deps.renderer, { content: `\n ${group}`, minHeight: 2 }),
            );
            for (const command of commands) {
                this.renderable.add(
                    new TextRenderable(this.deps.renderer, {
                        content: ` ${command.keys.padEnd(10)} ${command.description}`,
                        minHeight: 1,
                        wrapMode: "word",
                    }),
                );
            }
        }
    }

    destroy(): void {
        this.renderable.destroy();
    }
}

export { GROUP_ORDER, Help };
export type { HelpDeps };
