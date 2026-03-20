import { cn } from "@/lib/utils";

interface KeyBadgeProps {
    number: number;
    className?: string;
}

function KeyBadge({ number, className }: KeyBadgeProps) {
    return (
        <span
            className={cn(
                "flex h-[18px] min-w-[18px] items-center justify-center rounded px-1",
                "border-border bg-muted border border-b-2",
                "text-foreground text-[10px] leading-none font-semibold",
                className,
            )}>
            {number}
        </span>
    );
}

export { KeyBadge };
