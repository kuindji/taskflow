import { useCallback, useRef, useState } from "react";
import { Copy, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ComponentProps } from "react";

interface CopyButtonProps {
    value: string;
    tooltip?: string;
    tooltipSide?: ComponentProps<typeof Button>["tooltipSide"];
    className?: string;
}

function CopyButton({ value, tooltip = "Copy", tooltipSide = "bottom", className }: CopyButtonProps) {
    const [copied, setCopied] = useState(false);
    const timerRef = useRef<ReturnType<typeof setTimeout>>();

    const handleCopy = useCallback(() => {
        void navigator.clipboard.writeText(value);
        setCopied(true);
        clearTimeout(timerRef.current);
        timerRef.current = setTimeout(() => setCopied(false), 1500);
    }, [value]);

    return (
        <Button
            variant="ghost"
            size="icon-xs"
            onClick={handleCopy}
            aria-label={copied ? "Copied" : tooltip}
            tooltip={copied ? "Copied!" : tooltip}
            tooltipSide={tooltipSide}
            className={className}
        >
            {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
        </Button>
    );
}

export { CopyButton };
