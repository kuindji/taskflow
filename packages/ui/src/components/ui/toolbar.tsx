import * as React from "react";
import { cn } from "@/lib/utils";

interface ToolbarProps extends React.HTMLAttributes<HTMLDivElement> {
    noBorder?: boolean;
}

function Toolbar({ className, noBorder, ...props }: ToolbarProps) {
    return (
        <div
            className={cn(
                "flex h-9 max-h-9 min-h-9 items-center px-1.5",
                !noBorder && "border-border border-b",
                className,
            )}
            {...props}
        />
    );
}

export { Toolbar };
