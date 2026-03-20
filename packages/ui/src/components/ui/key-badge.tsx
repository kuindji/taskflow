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
                "border border-border border-b-2 bg-muted",
                "text-[10px] font-semibold leading-none text-foreground",
                className,
            )}>
            {number}
        </span>
    );
}

export { KeyBadge };
