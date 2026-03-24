import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useUIStore } from "@/stores/ui-store";
import { cn } from "@/lib/utils";

function Kbd({ children, className }: { children: React.ReactNode; className?: string }) {
    return (
        <kbd
            className={cn(
                "inline-flex h-[24px] min-w-[24px] items-center justify-center rounded",
                "bg-muted",
                "text-foreground text-sm leading-none font-normal",
                className,
            )}>
            {children}
        </kbd>
    );
}

function ShortcutRow({ keys, description }: { keys: React.ReactNode; description: string }) {
    return (
        <div className="flex items-center justify-between gap-4 py-1.5">
            <span className="text-muted-foreground text-xs">{description}</span>
            <span className="flex shrink-0 items-center gap-1">{keys}</span>
        </div>
    );
}

function ShortcutGroup({ title, children }: { title: string; children: React.ReactNode }) {
    return (
        <div className="mb-4 last:mb-0">
            <h3 className="text-foreground mb-1.5 text-xs font-semibold tracking-wide uppercase">
                {title}
            </h3>
            <div className="divide-border/40 divide-y">{children}</div>
        </div>
    );
}

function KeyboardShortcutsDialog() {
    const open = useUIStore((s) => s.shortcutsDialogOpen);
    const setOpen = useUIStore((s) => s.setShortcutsDialogOpen);

    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle>Keyboard Shortcuts</DialogTitle>
                </DialogHeader>
                <div className="mt-2 max-h-[60vh] overflow-y-auto pr-1">
                    <ShortcutGroup title="Panel Navigation">
                        <ShortcutRow
                            keys={
                                <>
                                    <Kbd>&#8984;</Kbd>
                                    <Kbd>&#8679;</Kbd>
                                    <Kbd>&#8592;</Kbd>
                                    <Kbd>&#8594;</Kbd>
                                </>
                            }
                            description="Cycle focus between panels"
                        />
                        <ShortcutRow
                            keys={
                                <>
                                    <Kbd>&#8984;</Kbd>
                                    <Kbd>&#8679;</Kbd>
                                </>
                            }
                            description="Hold to reveal focused panel"
                        />
                    </ShortcutGroup>

                    <ShortcutGroup title="Workspace (when focused)">
                        <ShortcutRow
                            keys={
                                <>
                                    <Kbd>&#8984;</Kbd>
                                    <Kbd className="text-xs">1</Kbd>
                                    &ndash;
                                    <Kbd className="text-xs">9</Kbd>
                                </>
                            }
                            description="Switch to tab by number"
                        />
                    </ShortcutGroup>

                    <ShortcutGroup title="Sidebar (when focused)">
                        <ShortcutRow
                            keys={
                                <>
                                    <Kbd>&#8984;</Kbd>
                                    <Kbd className="text-xs">1</Kbd>
                                    &ndash;
                                    <Kbd className="text-xs">9</Kbd>
                                </>
                            }
                            description="Jump to project or task by number"
                        />
                        <ShortcutRow
                            keys={
                                <>
                                    <Kbd>&#8984;</Kbd>
                                    <Kbd className="text-xs">0</Kbd>
                                </>
                            }
                            description="Switch to master workspace"
                        />
                        <ShortcutRow
                            keys={
                                <>
                                    <Kbd>&#8984;</Kbd>
                                    <Kbd>&#8593;</Kbd>
                                    <Kbd>&#8595;</Kbd>
                                </>
                            }
                            description="Navigate through items"
                        />
                        <ShortcutRow
                            keys={
                                <>
                                    <Kbd>&#8984;</Kbd>
                                    <Kbd>&#8592;</Kbd>
                                </>
                            }
                            description="Collapse project or go to parent"
                        />
                        <ShortcutRow
                            keys={
                                <>
                                    <Kbd>&#8984;</Kbd>
                                    <Kbd>&#8594;</Kbd>
                                </>
                            }
                            description="Expand project"
                        />
                    </ShortcutGroup>

                    <ShortcutGroup title="File Explorer (when focused)">
                        <ShortcutRow
                            keys={
                                <>
                                    <Kbd>&#8984;</Kbd>
                                    <Kbd>&#8593;</Kbd>
                                    <Kbd>&#8595;</Kbd>
                                </>
                            }
                            description="Navigate through files and folders"
                        />
                        <ShortcutRow
                            keys={
                                <>
                                    <Kbd>&#8984;</Kbd>
                                    <Kbd>&#8594;</Kbd>
                                </>
                            }
                            description="Expand folder or enter first child"
                        />
                        <ShortcutRow
                            keys={
                                <>
                                    <Kbd>&#8984;</Kbd>
                                    <Kbd>&#8592;</Kbd>
                                </>
                            }
                            description="Collapse folder or go to parent"
                        />
                        <ShortcutRow
                            keys={
                                <>
                                    <Kbd>&#8984;</Kbd>
                                    <Kbd>&#8629;</Kbd>
                                </>
                            }
                            description="Open file or toggle folder"
                        />
                        <ShortcutRow
                            keys={
                                <>
                                    <Kbd>&#8984;</Kbd>
                                    <Kbd className="text-xs">Home</Kbd>
                                </>
                            }
                            description="Jump to first item"
                        />
                        <ShortcutRow
                            keys={
                                <>
                                    <Kbd>&#8984;</Kbd>
                                    <Kbd className="text-xs">End</Kbd>
                                </>
                            }
                            description="Jump to last item"
                        />
                    </ShortcutGroup>

                    <ShortcutGroup title="General">
                        <ShortcutRow
                            keys={
                                <>
                                    <Kbd>&#8984;</Kbd>
                                    <Kbd>,</Kbd>
                                </>
                            }
                            description="Open settings"
                        />
                        <ShortcutRow
                            keys={
                                <>
                                    <Kbd>&#8984;</Kbd>
                                    <Kbd className="text-xs">T</Kbd>
                                </>
                            }
                            description="New terminal in current task or project"
                        />
                        <ShortcutRow
                            keys={
                                <>
                                    <Kbd>&#8984;</Kbd>
                                    <Kbd className="text-xs">N</Kbd>
                                </>
                            }
                            description="New task"
                        />
                        <ShortcutRow
                            keys={
                                <>
                                    <Kbd>&#8984;</Kbd>
                                    <Kbd className="text-xs">W</Kbd>
                                </>
                            }
                            description="Close active tab"
                        />
                        <ShortcutRow
                            keys={
                                <>
                                    <Kbd>&#8984;</Kbd>
                                    <Kbd className="text-xs">E</Kbd>
                                </>
                            }
                            description="Toggle file explorer"
                        />
                        <ShortcutRow
                            keys={
                                <>
                                    <Kbd>&#8984;</Kbd>
                                    <Kbd className="text-xs">I</Kbd>
                                </>
                            }
                            description="Toggle task info"
                        />
                        <ShortcutRow
                            keys={
                                <>
                                    <Kbd>&#8997;</Kbd>
                                    <Kbd className="text-xs">Z</Kbd>
                                </>
                            }
                            description="Toggle editor word wrap"
                        />
                        <ShortcutRow
                            keys={
                                <>
                                    <Kbd>&#8984;</Kbd>
                                    <Kbd>&#8679;</Kbd>
                                    <Kbd>C</Kbd>
                                </>
                            }
                            description="Toggle compact sidebar"
                        />
                        <ShortcutRow
                            keys={<Kbd>&#8984;</Kbd>}
                            description="Hold to show number badges"
                        />
                        <ShortcutRow
                            keys={
                                <>
                                    <Kbd>&#8984;</Kbd>
                                    <Kbd>/</Kbd>
                                </>
                            }
                            description="Toggle this dialog"
                        />
                    </ShortcutGroup>
                </div>
            </DialogContent>
        </Dialog>
    );
}

export { KeyboardShortcutsDialog };
