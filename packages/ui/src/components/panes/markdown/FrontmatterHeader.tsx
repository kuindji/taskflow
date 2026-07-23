import type { PageFrontmatter } from "@taskflow/shared";

interface FrontmatterHeaderProps {
    frontmatter: PageFrontmatter;
    /** Called with the raw target of a parent/child/related entry. */
    onNavigate: (target: string) => void;
}

interface LinkRowProps {
    label: string;
    targets: string[];
    onNavigate: (target: string) => void;
}

function LinkRow({ label, targets, onNavigate }: LinkRowProps) {
    if (targets.length === 0) return null;
    return (
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <span className="text-muted-foreground text-xs tracking-wide uppercase">{label}</span>
            {targets.map((target) => (
                <button
                    key={target}
                    type="button"
                    className="text-accent text-xs hover:underline"
                    onClick={() => onNavigate(target)}>
                    {target}
                </button>
            ))}
        </div>
    );
}

function FrontmatterHeader({ frontmatter, onNavigate }: FrontmatterHeaderProps) {
    const { title, parents, children, relatedPages, lastUpdated } = frontmatter;
    const hasContent =
        title !== undefined ||
        lastUpdated !== undefined ||
        parents.length > 0 ||
        children.length > 0 ||
        relatedPages.length > 0;
    if (!hasContent) return null;

    return (
        <div className="border-border/60 not-prose mb-6 flex flex-col gap-1.5 border-b pb-3">
            {title !== undefined && (
                <div className="text-foreground text-lg font-semibold">{title}</div>
            )}
            {lastUpdated !== undefined && (
                <div className="text-muted-foreground text-xs">Updated {lastUpdated}</div>
            )}
            <LinkRow label="Parents" targets={parents} onNavigate={onNavigate} />
            <LinkRow label="Children" targets={children} onNavigate={onNavigate} />
            <LinkRow label="Related" targets={relatedPages} onNavigate={onNavigate} />
        </div>
    );
}

export { FrontmatterHeader };
