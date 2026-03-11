import type { SessionStatus } from "@taskflow/shared";
import { cn } from "@/lib/utils";

interface StatusDotProps {
    status?: SessionStatus;
    className?: string;
}

export function StatusDot({ status, className }: StatusDotProps) {
    if (!status) return null;

    return (
        <span
            className={cn(
                "inline-block h-2 w-2 rounded-full shrink-0",
                status === "working" && "bg-success",
                status === "attention" && "bg-warning",
                className,
            )}
        />
    );
}
