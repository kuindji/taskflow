import { Trash2 } from "lucide-react";
import type { ThemeRecord } from "@taskflow/shared";
import { cn } from "@/lib/utils";

interface ThemeCardProps {
    theme: ThemeRecord;
    isActive: boolean;
    onClick: () => void;
    onDelete?: () => void;
}

function ThemeCard({ theme, isActive, onClick, onDelete }: ThemeCardProps) {
    const { source } = theme;
    const { colors } = source;
    const isDeletable = source.origin !== "bundled";
    const swatches = [
        colors.ansi.red,
        colors.ansi.green,
        colors.ansi.yellow,
        colors.ansi.blue,
        colors.ansi.magenta,
        colors.ansi.cyan,
    ];

    return (
        <div className="group relative">
            {isDeletable && onDelete && (
                <button
                    type="button"
                    aria-label={`Delete ${source.name} theme`}
                    className="text-muted-foreground hover:bg-destructive/20 hover:text-destructive focus-visible:ring-ring absolute top-1.5 right-1.5 z-10 rounded p-1 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100 focus-visible:ring-2"
                    onClick={() => {
                        onDelete();
                    }}
                >
                    <Trash2 className="h-3 w-3" />
                </button>
            )}
            <button
                type="button"
                onClick={onClick}
                className={cn(
                    "flex w-full flex-col rounded-lg gap-2 border text-left transition-colors",
                    "hover:border-accent",
                    isActive ? "border-accent bg-accent/10" : "border-border",
                )}
            >
                {/* Color preview */}
                <div
                    className="flex h-16 items-end gap-0.5 overflow-hidden rounded-md p-2"
                    style={{ backgroundColor: colors.background }}
                    aria-hidden="true"
                >
                    <span
                        className="truncate font-mono text-xs"
                        style={{ color: colors.foreground }}
                    >
                        ~/project $
                    </span>
                    <span
                        className="shrink-0 font-mono text-xs"
                        style={{ color: colors.ansi.green }}
                    >
                        {" "}git status
                    </span>
                </div>
                {/* Swatch row */}
                <div className="flex gap-1 p-3 w-full mt-auto">
                    {swatches.map((color, i) => (
                        <div
                            key={i}
                            className="h-3 flex-1 rounded-sm"
                            style={{ backgroundColor: color }}
                        />
                    ))}
                </div>
                {/* Name + badge */}
                <div className="flex items-center gap-2 p-3">
                    <span className="truncate text-sm font-medium">{source.name}</span>
                    {source.origin !== "bundled" && (
                        <span className="text-muted-foreground bg-muted rounded px-1.5 py-0.5 text-[10px]">
                            {source.origin}
                        </span>
                    )}
                </div>
            </button>
        </div>
    );
}

export { ThemeCard };
