import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ActionDefinition } from "@taskflow/shared";
import { SquareTerminal, Zap } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { fuzzyMatch } from "@/lib/fuzzy-match";
import { isDialogOpen } from "@/lib/global-shortcuts";
import { cn } from "@/lib/utils";
import { useActiveWorkspace } from "@/hooks/useActiveWorkspace";
import { useRunMenu } from "@/hooks/useRunMenu";
import { useUIStore } from "@/stores/ui-store";

type PaletteEntry =
    | { kind: "action"; action: ActionDefinition }
    | { kind: "script"; name: string };

interface PaletteRow {
    entry: PaletteEntry;
    label: string;
    detail: string;
    disabled: boolean;
    indices: number[];
}

interface PaletteGroup {
    title: string;
    rows: PaletteRow[];
}

function entryKey(entry: PaletteEntry): string {
    return entry.kind === "action" ? `action:${entry.action.id}` : `script:${entry.name}`;
}

function HighlightedLabel({ text, indices }: { text: string; indices: number[] }) {
    if (indices.length === 0) return <>{text}</>;
    const matched = new Set(indices);
    return (
        <>
            {Array.from(text, (char, i) =>
                matched.has(i) ? (
                    <span key={i} className="text-foreground font-semibold">
                        {char}
                    </span>
                ) : (
                    <span key={i}>{char}</span>
                ),
            )}
        </>
    );
}

function CommandPaletteDialog() {
    const open = useUIStore((s) => s.commandPaletteOpen);
    const setOpen = useUIStore((s) => s.setCommandPaletteOpen);
    const [query, setQuery] = useState("");
    const [selectedIndex, setSelectedIndex] = useState(0);
    const listRef = useRef<HTMLDivElement>(null);

    const workspace = useActiveWorkspace();
    const hasTask = workspace.scope === "task" && workspace.task !== null;

    const { data, callbacks } = useRunMenu({
        projectId: workspace.project?.id ?? "",
        projectPath: workspace.workingDir ?? "",
        taskId: workspace.task?.id,
        showAgentOptions: false,
        enabled: open && hasTask,
    });

    // Reset transient state whenever the palette opens
    useEffect(() => {
        if (open) {
            setQuery("");
            setSelectedIndex(0);
        }
    }, [open]);

    useEffect(() => {
        setSelectedIndex(0);
    }, [query]);

    const groups: PaletteGroup[] = useMemo(() => {
        if (!hasTask) return [];

        const filterRows = (rows: PaletteRow[]): PaletteRow[] => {
            if (!query) return rows;
            const scored: Array<{ row: PaletteRow; score: number }> = [];
            for (const row of rows) {
                const match = fuzzyMatch(query, row.label);
                if (!match) continue;
                scored.push({ row: { ...row, indices: match.indices }, score: match.score });
            }
            scored.sort((a, b) => b.score - a.score);
            return scored.map((s) => s.row);
        };

        const actionRows: PaletteRow[] = data.standaloneActions.map((action) => ({
            entry: { kind: "action", action },
            label: action.name,
            detail: data.online ? action.sessionType : "offline",
            disabled: !data.online,
            indices: [],
        }));

        const scriptRows: PaletteRow[] = Object.keys(data.scripts).map((name) => ({
            entry: { kind: "script", name },
            label: name,
            detail: data.defaultRuntime,
            disabled: false,
            indices: [],
        }));

        return [
            { title: "Actions", rows: filterRows(actionRows) },
            { title: "package.json", rows: filterRows(scriptRows) },
        ].filter((group) => group.rows.length > 0);
    }, [hasTask, data.standaloneActions, data.scripts, data.defaultRuntime, data.online, query]);

    const flatRows = useMemo(() => groups.flatMap((g) => g.rows), [groups]);

    // Data can refresh while open (scripts response, connectivity), shrinking
    // the list below selectedIndex — clamp so highlight and Enter stay valid.
    const activeIndex = Math.min(selectedIndex, Math.max(0, flatRows.length - 1));

    const runRow = useCallback(
        (row: PaletteRow) => {
            if (row.disabled) return;
            if (row.entry.kind === "script") {
                callbacks.onRunScript(row.entry.name);
            } else {
                callbacks.onRunAction(row.entry.action);
            }
            setOpen(false);
        },
        [callbacks, setOpen],
    );

    const onInputKeyDown = useCallback(
        (e: React.KeyboardEvent<HTMLInputElement>) => {
            if (e.key === "ArrowDown") {
                e.preventDefault();
                if (flatRows.length > 0) {
                    setSelectedIndex((i) => (i + 1) % flatRows.length);
                }
            } else if (e.key === "ArrowUp") {
                e.preventDefault();
                if (flatRows.length > 0) {
                    setSelectedIndex((i) => (i - 1 + flatRows.length) % flatRows.length);
                }
            } else if (e.key === "Enter") {
                e.preventDefault();
                const row = flatRows[activeIndex];
                if (row) runRow(row);
            }
        },
        [flatRows, activeIndex, runRow],
    );

    // Keep the selected row visible while navigating with arrows
    useEffect(() => {
        const el = listRef.current?.querySelector("[data-selected='true']");
        el?.scrollIntoView({ block: "nearest" });
    }, [activeIndex, groups]);

    // Electron menu accelerator (CmdOrCtrl+Shift+P). The palette itself
    // renders a dialog-content, so isDialogOpen() is true while it is open —
    // the !commandPaletteOpen guard keeps toggle-to-close working while still
    // blocking the shortcut when some other dialog is open.
    useEffect(() => {
        const subscribe = window.taskflow?.onOpenCommandPalette;
        if (!subscribe) return;
        return subscribe(() => {
            const store = useUIStore.getState();
            if (isDialogOpen() && !store.commandPaletteOpen) return;
            store.toggleCommandPalette();
        });
    }, []);

    let rowIndex = -1;

    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <DialogContent
                showCloseButton={false}
                className="top-[12vh] bottom-auto my-0 gap-0 overflow-hidden p-0 sm:max-w-xl">
                <DialogTitle className="sr-only">Command Palette</DialogTitle>
                <input
                    type="text"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    onKeyDown={onInputKeyDown}
                    placeholder="Run an action or script..."
                    spellCheck={false}
                    className="placeholder:text-muted-foreground border-border w-full border-b bg-transparent px-4 py-3 text-sm outline-none"
                />
                <div ref={listRef} className="max-h-[50vh] overflow-y-auto p-1">
                    {!hasTask ? (
                        <p className="text-muted-foreground px-3 py-6 text-center text-sm">
                            Select a task to run actions
                        </p>
                    ) : flatRows.length === 0 ? (
                        <p className="text-muted-foreground px-3 py-6 text-center text-sm">
                            {query ? "No results" : "No actions or scripts available"}
                        </p>
                    ) : (
                        groups.map((group) => (
                            <div key={group.title}>
                                <div className="text-muted-foreground px-3 pt-2 pb-1 text-xs font-semibold tracking-wide uppercase">
                                    {group.title}
                                </div>
                                {group.rows.map((row) => {
                                    rowIndex += 1;
                                    const index = rowIndex;
                                    const Icon = row.entry.kind === "action" ? Zap : SquareTerminal;
                                    return (
                                        <div
                                            key={entryKey(row.entry)}
                                            data-selected={index === activeIndex}
                                            onMouseEnter={() => setSelectedIndex(index)}
                                            onClick={() => runRow(row)}
                                            className={cn(
                                                "text-muted-foreground flex cursor-pointer items-center gap-2 rounded-sm px-3 py-1.5 text-sm",
                                                index === activeIndex && "bg-accent text-accent-foreground",
                                                row.disabled && "cursor-default opacity-50",
                                            )}>
                                            <Icon className="h-4 w-4 shrink-0" />
                                            <span className="truncate">
                                                <HighlightedLabel text={row.label} indices={row.indices} />
                                            </span>
                                            <span className="text-muted-foreground ml-auto shrink-0 text-xs">
                                                {row.detail}
                                            </span>
                                        </div>
                                    );
                                })}
                            </div>
                        ))
                    )}
                </div>
                <div className="text-muted-foreground border-border flex items-center gap-3 border-t px-3 py-1.5 text-xs">
                    <span>&#8593;&#8595; navigate</span>
                    <span>&#8629; run</span>
                    <span>esc close</span>
                </div>
            </DialogContent>
        </Dialog>
    );
}

export { CommandPaletteDialog };
