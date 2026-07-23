import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { OutlineEntry, WikiIndexData } from "@taskflow/shared";
import { cn } from "@/lib/utils";

interface WikiRailProps {
    outline: OutlineEntry[];
    index: WikiIndexData;
    pageId: string;
    /** The pane's scroll container, used to observe headings and to scroll. */
    scrollContainer: HTMLElement | null;
    onOpenPage: (pageId: string) => void;
}

interface RailSectionProps {
    title: string;
    children: ReactNode;
}

function RailSection({ title, children }: RailSectionProps) {
    return (
        <div className="flex flex-col gap-1">
            <div className="text-muted-foreground text-[11px] tracking-wide uppercase">{title}</div>
            {children}
        </div>
    );
}

function WikiRail({ outline, index, pageId, scrollContainer, onOpenPage }: WikiRailProps) {
    const [activeId, setActiveId] = useState<string | null>(null);

    const page = useMemo(() => index.pages.find((entry) => entry.id === pageId), [index, pageId]);
    const backlinks = index.backlinks[pageId] ?? [];
    const children = page?.children ?? [];

    useEffect(() => {
        if (!scrollContainer || outline.length === 0) return;
        const observer = new IntersectionObserver(
            (entries) => {
                const visible = entries
                    .filter((entry) => entry.isIntersecting)
                    .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
                if (visible[0]?.target.id) setActiveId(visible[0].target.id);
            },
            { root: scrollContainer, rootMargin: "0px 0px -70% 0px", threshold: 0 },
        );
        for (const entry of outline) {
            const element = scrollContainer.querySelector(`#${CSS.escape(entry.id)}`);
            if (element) observer.observe(element);
        }
        return () => observer.disconnect();
    }, [outline, scrollContainer]);

    if (outline.length === 0 && backlinks.length === 0 && children.length === 0) return null;

    return (
        <div className="border-border/50 flex h-full flex-col gap-4 overflow-auto border-l p-3 text-[13px]">
            {outline.length > 0 && (
                <RailSection title="On this page">
                    {outline.map((entry) => (
                        <button
                            key={entry.id}
                            type="button"
                            onClick={() =>
                                scrollContainer
                                    ?.querySelector(`#${CSS.escape(entry.id)}`)
                                    ?.scrollIntoView({ block: "start" })
                            }
                            className={cn(
                                "hover:text-foreground truncate text-left",
                                entry.id === activeId ? "text-foreground" : "text-muted-foreground",
                            )}
                            style={{ paddingLeft: (entry.depth - 1) * 8 }}>
                            {entry.text}
                        </button>
                    ))}
                </RailSection>
            )}

            {children.length > 0 && (
                <RailSection title="Children">
                    {children.map((childId) => (
                        <button
                            key={childId}
                            type="button"
                            onClick={() => onOpenPage(childId)}
                            className="text-accent truncate text-left hover:underline">
                            {childId}
                        </button>
                    ))}
                </RailSection>
            )}

            {backlinks.length > 0 && (
                <RailSection title="Linked from">
                    {backlinks.map((from) => (
                        <button
                            key={from}
                            type="button"
                            onClick={() => onOpenPage(from)}
                            className="text-accent truncate text-left hover:underline">
                            {index.pages.find((entry) => entry.id === from)?.title ?? from}
                        </button>
                    ))}
                </RailSection>
            )}
        </div>
    );
}

export { WikiRail };
