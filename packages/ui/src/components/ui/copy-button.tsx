import { useCallback, useRef, useState } from "react";
import { Copy, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ComponentProps } from "react";

interface CopyButtonProps {
    value: string;
    tooltip?: string;
    tooltipSide?: ComponentProps<typeof Button>["tooltipSide"];
    variant?: ComponentProps<typeof Button>["variant"];
    size?: ComponentProps<typeof Button>["size"];
    className?: string;
}

function CopyButton({
    value,
    tooltip = "Copy",
    tooltipSide = "bottom",
    variant = "ghost",
    size = "icon-xs",
    className,
}: CopyButtonProps) {
    const [copied, setCopied] = useState(false);
    const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

    const handleCopy = useCallback(() => {
        void navigator.clipboard.writeText(value);
        setCopied(true);
        clearTimeout(timerRef.current);
        timerRef.current = setTimeout(() => setCopied(false), 1500);
    }, [value]);

    return (
        <Button
            variant={variant}
            size={size}
            onClick={handleCopy}
            aria-label={copied ? "Copied" : tooltip}
            tooltip={copied ? "Copied!" : tooltip}
            tooltipSide={tooltipSide}
            className={className}>
            {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
        </Button>
    );
}

export { CopyButton };
