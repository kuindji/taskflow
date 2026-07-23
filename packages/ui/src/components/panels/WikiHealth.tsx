import { useState, type ReactNode } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import type { WikiIndexData } from "@taskflow/shared";

interface WikiHealthProps {
    index: WikiIndexData;
    onOpenPage: (pageId: string) => void;
}

interface HealthGroupProps {
    title: string;
    count: number;
    children: ReactNode;
}

function HealthGroup({ title, count, children }: HealthGroupProps) {
    const [open, setOpen] = useState(false);
    if (count === 0) return null;
    return (
        <div className="flex flex-col">
            <button
                type="button"
                onClick={() => setOpen((value) => !value)}
                className="text-muted-foreground hover:text-foreground flex items-center gap-1 py-0.5 text-left text-[12px]">
                {open ? (
                    <ChevronDown className="h-3.5 w-3.5" />
                ) : (
                    <ChevronRight className="h-3.5 w-3.5" />
                )}
                {title} ({count})
            </button>
            {open && <div className="flex flex-col pl-5">{children}</div>}
        </div>
    );
}

function WikiHealth({ index, onOpenPage }: WikiHealthProps) {
    if (index.unresolved.length === 0 && index.orphans.length === 0) return null;

    return (
        <div className="border-border/50 flex flex-col gap-1 border-t px-2 py-2">
            <HealthGroup title="Broken links" count={index.unresolved.length}>
                {index.unresolved.map((link) => (
                    <button
                        key={`${link.from}->${link.target}`}
                        type="button"
                        onClick={() => onOpenPage(link.from)}
                        className="truncate text-left text-[12px]">
                        <span className="text-muted-foreground">{link.from}</span>
                        <span className="text-destructive"> → {link.target}</span>
                    </button>
                ))}
            </HealthGroup>
            <HealthGroup title="Orphans" count={index.orphans.length}>
                {index.orphans.map((pageId) => (
                    <button
                        key={pageId}
                        type="button"
                        onClick={() => onOpenPage(pageId)}
                        className="text-muted-foreground hover:text-foreground truncate text-left text-[12px]">
                        {pageId}
                    </button>
                ))}
            </HealthGroup>
        </div>
    );
}

export { WikiHealth };
