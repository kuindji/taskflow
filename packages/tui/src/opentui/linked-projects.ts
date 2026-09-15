import {
    BoxRenderable,
    InputRenderable,
    TextRenderable,
    type CliRenderer,
    type KeyEvent,
} from "@opentui/core";
import type { LinkedProject, Project } from "@taskflow/shared";
import { editLine, isChorded } from "./line-input";
import { SELECTED_TEXT_STYLE } from "./selection-style";

interface LinkedProjectsDeps {
    renderer: CliRenderer;
    project: Project;
    /** Projects to name links and offer as new ones. The project itself and hidden ones are never offered. */
    projects: readonly Project[];
    /** Receives the complete new link list. Answer with `setLinks` or `setError`. */
    onSave(linkedProjects: LinkedProject[]): void;
    onClose(): void;
    onStateChange?(): void;
}

/** `list`: the current links. `pick`: choose a project to link. `note`: type a link's note. */
type LinkedProjectsMode = "list" | "pick" | "note";

class LinkedProjects {
    readonly renderable: BoxRenderable;
    private readonly dialog: BoxRenderable;
    private links: LinkedProject[];
    private mode: LinkedProjectsMode = "list";
    private selected = 0;
    private pickIndex = 0;
    /** The link whose note is being typed; `isNew` when it is not in `links` yet. */
    private editing: { projectId: string; isNew: boolean } | null = null;
    private note = "";
    private noteInput: InputRenderable | null = null;
    private pending = false;
    private error: string | null = null;

    constructor(private readonly deps: LinkedProjectsDeps) {
        this.links = [...(deps.project.linkedProjects ?? [])];
        this.renderable = new BoxRenderable(deps.renderer, {
            id: "linked-projects-overlay",
            position: "absolute",
            width: "100%",
            height: "100%",
            zIndex: 100,
            onMouseDown: (event) => {
                event.preventDefault();
                event.stopPropagation();
            },
        });
        this.dialog = new BoxRenderable(deps.renderer, {
            id: "linked-projects-dialog",
            title: "Linked projects",
            border: true,
            position: "absolute",
            left: "15%",
            top: "20%",
            width: "70%",
            maxWidth: 72,
            minHeight: 6,
            flexDirection: "column",
            backgroundColor: "#000000",
        });
        this.renderable.add(this.dialog);
        this.rebuild();
    }

    get keyHints(): string {
        if (this.pending) return " Saving...";
        if (this.mode === "pick") return " ↑↓ Select  Enter Choose  Esc Back";
        if (this.mode === "note") return " Enter Save  Esc Back";
        return " ↑↓ Select  a Add  e Edit note  d Remove  Esc Close";
    }

    /** The saved link list: back to the list view. */
    setLinks(links: readonly LinkedProject[]): void {
        this.links = [...links];
        this.pending = false;
        this.error = null;
        this.mode = "list";
        this.editing = null;
        this.selected = Math.max(0, Math.min(this.selected, this.links.length - 1));
        this.rebuild();
    }

    setError(error: string): void {
        this.pending = false;
        this.error = error;
        this.rebuild();
    }

    handleKey(event: KeyEvent): void {
        if (event.eventType !== "press" || this.pending) return;
        if (this.mode === "note") {
            this.handleNoteKey(event);
            return;
        }
        if (isChorded(event)) return;
        const down = event.name === "down" || event.sequence === "j";
        const up = event.name === "up" || event.sequence === "k";
        const enter = event.name === "return" || event.name === "enter";
        if (this.mode === "pick") {
            const candidates = this.candidates();
            if (event.name === "escape") this.showList();
            else if (down || up) {
                this.pickIndex = clamp(this.pickIndex + (down ? 1 : -1), candidates.length);
                this.rebuild();
            } else if (enter && candidates[this.pickIndex]) {
                this.editNote(candidates[this.pickIndex].id, "", true);
            }
            return;
        }
        const link = this.links[this.selected];
        if (event.name === "escape" || event.sequence === "q") this.deps.onClose();
        else if (down || up) {
            this.selected = clamp(this.selected + (down ? 1 : -1), this.links.length);
            this.rebuild();
        } else if (event.sequence === "a") {
            this.error = this.candidates().length === 0 ? "No other projects to link." : null;
            if (!this.error) {
                this.mode = "pick";
                this.pickIndex = 0;
            }
            this.rebuild();
        } else if ((event.sequence === "e" || enter) && link) {
            this.editNote(link.projectId, link.note, false);
        } else if (event.sequence === "d" && link) {
            this.save(this.links.filter((candidate) => candidate !== link));
        }
    }

    private handleNoteKey(event: KeyEvent): void {
        const input = this.noteInput;
        const editing = this.editing;
        if (!input || !editing) return;
        switch (editLine(input, event)) {
            case "cancel":
                this.showList();
                return;
            case "edit":
                this.note = input.value;
                return;
            case "submit": {
                const note = input.value.trim();
                this.save(
                    editing.isNew
                        ? [...this.links, { projectId: editing.projectId, note }]
                        : this.links.map((link) =>
                              link.projectId === editing.projectId ? { ...link, note } : link,
                          ),
                );
                return;
            }
            default:
                return;
        }
    }

    private candidates(): Project[] {
        const linked = new Set(this.links.map((link) => link.projectId));
        return this.deps.projects.filter(
            (project) =>
                project.id !== this.deps.project.id &&
                project.hidden !== true &&
                !linked.has(project.id),
        );
    }

    private projectName(projectId: string): string {
        return this.deps.projects.find((project) => project.id === projectId)?.name ?? projectId;
    }

    private editNote(projectId: string, note: string, isNew: boolean): void {
        this.editing = { projectId, isNew };
        this.note = note;
        this.mode = "note";
        this.error = null;
        this.rebuild();
    }

    private showList(): void {
        this.mode = "list";
        this.editing = null;
        this.error = null;
        this.rebuild();
    }

    private save(links: LinkedProject[]): void {
        this.pending = true;
        this.error = null;
        this.rebuild();
        this.deps.onSave(links);
    }

    private line(content: string, selected = false): TextRenderable {
        return new TextRenderable(this.deps.renderer, {
            content,
            height: 1,
            truncate: true,
            ...(selected ? SELECTED_TEXT_STYLE : {}),
        });
    }

    private rebuild(): void {
        for (const child of [...this.dialog.getChildren()]) child.destroy();
        this.noteInput = null;
        if (this.mode === "list") {
            this.dialog.add(this.line(` ${this.deps.project.name}`));
            if (this.links.length === 0) this.dialog.add(this.line(" No linked projects."));
            for (const [index, link] of this.links.entries()) {
                const note = link.note ? `  ${link.note}` : "";
                this.dialog.add(
                    this.line(
                        ` ${this.projectName(link.projectId)}${note}`,
                        index === this.selected,
                    ),
                );
            }
        } else if (this.mode === "pick") {
            this.dialog.add(this.line(" Link a project:"));
            for (const [index, project] of this.candidates().entries()) {
                this.dialog.add(this.line(` ${project.name}`, index === this.pickIndex));
            }
        } else if (this.editing) {
            this.dialog.add(
                this.line(` Note for ${this.projectName(this.editing.projectId)} (optional)`),
            );
            this.noteInput = new InputRenderable(this.deps.renderer, {
                id: "linked-project-note",
                placeholder: "What the link is for",
                value: this.note,
                width: "100%",
            });
            this.dialog.add(this.noteInput);
            this.noteInput.focus();
        }
        if (this.pending) this.dialog.add(this.line(" Saving..."));
        else if (this.error) {
            this.dialog.add(
                new TextRenderable(this.deps.renderer, {
                    content: ` ${this.error}`,
                    minHeight: 1,
                    wrapMode: "word",
                }),
            );
        }
        this.deps.onStateChange?.();
    }

    destroy(): void {
        this.renderable.destroy();
    }
}

function clamp(index: number, length: number): number {
    return Math.max(0, Math.min(length - 1, index));
}

export { LinkedProjects };
export type { LinkedProjectsDeps };
