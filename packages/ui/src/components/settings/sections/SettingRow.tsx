import { Info } from "lucide-react";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

interface SettingRowProps {
    label: string;
    hint?: string;
    children: React.ReactNode;
    className?: string;
}

function SettingRow({ label, hint, children, className }: SettingRowProps) {
    return (
        <div
            className={cn(
                "hover:bg-island-base flex items-center justify-between rounded-md transition-colors",
                className,
            )}>
            <div className="flex min-w-0 flex-1 items-center gap-1.5 pr-6">
                <div className="text-secondary-foreground text-[13px] font-medium">{label}</div>
                {hint && (
                    <Tooltip>
                        <TooltipTrigger>
                            <Info className="text-muted-foreground h-3 w-3 shrink-0" />
                        </TooltipTrigger>
                        <TooltipContent side="top">{hint}</TooltipContent>
                    </Tooltip>
                )}
            </div>
            <div className="shrink-0">{children}</div>
        </div>
    );
}

export { SettingRow };
export type { SettingRowProps };
