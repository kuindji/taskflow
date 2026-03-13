import { useRef, useState, useEffect, type ReactNode } from "react";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

function useIsTruncated(ref: React.RefObject<HTMLElement | null>, enabled: boolean) {
    const [isTruncated, setIsTruncated] = useState(false);

    useEffect(() => {
        if (!enabled) return;
        const el = ref.current;
        if (!el) return;

        const check = () => {
            setIsTruncated(el.scrollWidth > el.clientWidth);
        };

        check();

        const observer = new ResizeObserver(check);
        observer.observe(el);

        return () => observer.disconnect();
    }, [ref, enabled]);

    return enabled ? isTruncated : false;
}

interface TruncatedTextProps extends React.HTMLAttributes<HTMLElement> {
    as?: React.ElementType;
    tooltipContent?: ReactNode;
    truncate?: boolean;
    tooltip?: boolean;
}

function TruncatedText({
    as: Component = "span",
    className,
    children,
    tooltipContent,
    truncate = true,
    tooltip = false,
    ...props
}: TruncatedTextProps) {
    const ref = useRef<HTMLElement>(null);
    const isTruncated = useIsTruncated(ref, tooltip);
    const [tooltipOpen, setTooltipOpen] = useState(false);

    if (!truncate) {
        return (
            <Component
                data-slot="truncated-text"
                className={cn("block min-w-0", className)}
                {...props}
            >
                {children}
            </Component>
        );
    }

    if (!tooltip) {
        return (
            <Component
                data-slot="truncated-text"
                className={cn("block min-w-0 truncate", className)}
                {...props}
            >
                {children}
            </Component>
        );
    }

    return (
        <Tooltip
            open={tooltipOpen}
            onOpenChange={(open) => setTooltipOpen(open && isTruncated)}
        >
            <TooltipTrigger asChild>
                <Component
                    ref={ref}
                    data-slot="truncated-text"
                    className={cn("block min-w-0 truncate", className)}
                    {...props}
                >
                    {children}
                </Component>
            </TooltipTrigger>
            <TooltipContent>{tooltipContent ?? children}</TooltipContent>
        </Tooltip>
    );
}

export { TruncatedText };
