import {
    BoxRenderable,
    ScrollBoxRenderable,
    TextRenderable,
    type CliRenderer,
    type KeyEvent,
} from "@opentui/core";
import type { GitStatusResult } from "@taskflow/shared";
import { changeLabel, gitChanges, stableChangeIndex, type GitChange } from "../git/model";
import type { GitDiffState } from "../git/store";
import { SELECTED_TEXT_STYLE } from "./selection-style";

interface GitChangesDeps {
    renderer: CliRenderer;
    status: GitStatusResult | null;
    diff: GitDiffState | null;
    onSelect(change: GitChange): void;
    onStage(change: GitChange): void;
    onUnstage(change: GitChange): void;
    onStageAll(): void;
    onUnstageAll(): void;
    onCommit(): void;
    onClose(): void;
    onStateChange?(): void;
}

class GitChanges {
    readonly renderable: BoxRenderable;
    private readonly filesPane: ScrollBoxRenderable;
    private readonly diffPane: ScrollBoxRenderable;
    private status: GitStatusResult | null;
    private diff: GitDiffState | null;
    private changes: GitChange[];
    private selected = 0;
    private pending = false;
    private error: string | null = null;

    constructor(private readonly deps: GitChangesDeps) {
        this.status = deps.status;
        this.diff = deps.diff;
        this.changes = gitChanges(deps.status);
        this.renderable = new BoxRenderable(deps.renderer, {
            id: "git-changes",
            width: "100%",
            height: "100%",
            flexDirection: "row",
            overflow: "hidden",
        });
        this.filesPane = new ScrollBoxRenderable(deps.renderer, {
            id: "git-files",
            width: "38%",
            minWidth: 18,
            height: "100%",
            border: true,
            scrollY: true,
            scrollX: false,
            onMouseScroll: (event) => {
                const direction = event.scroll?.direction;
                if (direction !== "up" && direction !== "down") return;
                event.preventDefault();
                event.stopPropagation();
                this.move(direction === "up" ? -1 : 1);
            },
        });
        this.diffPane = new ScrollBoxRenderable(deps.renderer, {
            id: "git-diff",
            flexGrow: 1,
            height: "100%",
            border: true,
            scrollY: true,
            scrollX: false,
        });
        this.renderable.add(this.filesPane);
        this.renderable.add(this.diffPane);
        this.rebuild();
    }

    get selectedChange(): GitChange | null {
        return this.changes[this.selected] ?? null;
    }

    get keyHints(): string {
        return this.pending
            ? " Working..."
            : " ↑↓ File  s Stage  u Unstage  S Stage all  U Unstage all  c Commit  Esc/q Sessions";
    }

    update(status: GitStatusResult | null, diff: GitDiffState | null): void {
        const selectedKey = this.selectedChange?.key ?? null;
        const previousIndex = this.selected;
        this.status = status;
        this.diff = diff;
        this.changes = gitChanges(status);
        this.selected = stableChangeIndex(this.changes, selectedKey, previousIndex);
        this.pending = false;
        this.rebuild();
        const selected = this.selectedChange;
        if (selected && selected.key !== selectedKey) this.deps.onSelect(selected);
    }

    setPending(pending: boolean): void {
        this.pending = pending;
        this.error = null;
        this.rebuild();
    }

    setError(error: string): void {
        this.pending = false;
        this.error = error;
        this.rebuild();
    }

    handleKey(event: KeyEvent): void {
        if (event.eventType !== "press" || this.pending) return;
        const chorded = event.ctrl || event.meta || event.option || event.super || event.hyper;
        if (chorded) return;
        if (event.name === "escape" || event.sequence === "q") return this.deps.onClose();
        if (event.name === "down" || event.sequence === "j") return this.move(1);
        if (event.name === "up" || event.sequence === "k") return this.move(-1);
        if (event.name === "pagedown") return this.diffPane.scrollBy(8);
        if (event.name === "pageup") return this.diffPane.scrollBy(-8);
        if (event.sequence === "S") return this.deps.onStageAll();
        if (event.sequence === "U") return this.deps.onUnstageAll();
        if (event.sequence === "c") return this.deps.onCommit();
        const selected = this.selectedChange;
        if (!selected) return;
        if (event.sequence === "s" && !selected.staged) this.deps.onStage(selected);
        if (event.sequence === "u" && selected.staged) this.deps.onUnstage(selected);
    }

    private move(delta: number): void {
        if (this.changes.length === 0) return;
        const next = Math.min(this.changes.length - 1, Math.max(0, this.selected + delta));
        if (next === this.selected) return;
        this.selected = next;
        this.error = null;
        this.rebuild();
        const selected = this.selectedChange;
        if (selected) this.deps.onSelect(selected);
    }

    private clear(parent: BoxRenderable): void {
        for (const child of [...parent.getChildren()]) child.destroy();
    }

    private rebuild(): void {
        this.clear(this.filesPane);
        this.clear(this.diffPane);
        const branch = this.status?.branch ?? "no branch";
        this.filesPane.add(
            new TextRenderable(this.deps.renderer, {
                content: ` ${branch}  ↑${String(this.status?.ahead ?? 0)} ↓${String(this.status?.behind ?? 0)}`,
                height: 1,
            }),
        );
        let previousGroup: GitChange["group"] | null = null;
        for (const [index, change] of this.changes.entries()) {
            if (change.group !== previousGroup) {
                previousGroup = change.group;
                this.filesPane.add(
                    new TextRenderable(this.deps.renderer, {
                        content: ` ${change.group === "staged" ? "Staged" : "Unstaged"}`,
                        height: 1,
                    }),
                );
            }
            this.filesPane.add(
                new TextRenderable(this.deps.renderer, {
                    content: ` ${changeLabel(change)}`,
                    height: 1,
                    truncate: true,
                    wrapMode: "none",
                    ...(index === this.selected ? SELECTED_TEXT_STYLE : {}),
                }),
            );
        }
        if (this.changes.length === 0) {
            this.filesPane.add(
                new TextRenderable(this.deps.renderer, { content: " Working tree clean.", height: 1 }),
            );
        }
        if (this.pending) {
            this.filesPane.add(new TextRenderable(this.deps.renderer, { content: " Working...", height: 1 }));
        } else if (this.error) {
            this.filesPane.add(
                new TextRenderable(this.deps.renderer, {
                    content: ` ${this.error}`,
                    minHeight: 1,
                    wrapMode: "word",
                }),
            );
        }

        const selected = this.selectedChange;
        let content = " Select a changed file.";
        if (selected) {
            content =
                this.diff?.key === selected.key
                    ? this.diff.text ??
                      " No text diff is available. The file may be binary or unchanged."
                    : " Loading diff...";
        }
        this.diffPane.add(
            new TextRenderable(this.deps.renderer, {
                content,
                width: "100%",
                minHeight: 1,
                wrapMode: "char",
                selectable: true,
            }),
        );
        this.deps.onStateChange?.();
    }

    destroy(): void {
        this.renderable.destroy();
    }
}

export { GitChanges };
export type { GitChangesDeps };
