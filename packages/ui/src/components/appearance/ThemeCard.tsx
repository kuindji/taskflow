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
        <button
            onClick={onClick}
            className={cn(
                "group relative flex flex-col rounded-lg border p-3 text-left transition-colors",
                "hover:border-accent",
                isActive ? "border-accent bg-accent/10" : "border-border",
            )}
        >
            {isDeletable && onDelete && (
                <div
                    role="button"
                    tabIndex={0}
                    className="text-muted-foreground hover:bg-destructive/20 hover:text-destructive absolute top-1.5 right-1.5 hidden rounded p-1 group-hover:block"
                    onClick={(e) => {
                        e.stopPropagation();
                        onDelete();
                    }}
                    onKeyDown={(e) => {
                        if (e.key === "Enter") {
                            e.stopPropagation();
                            onDelete();
                        }
                    }}
                >
                    <Trash2 className="h-3 w-3" />
                </div>
            )}
            {/* Color preview */}
            <div
                className="mb-2 flex h-16 items-end gap-0.5 rounded-md p-2"
                style={{ backgroundColor: colors.background }}
            >
                <span
                    className="truncate font-mono text-xs"
                    style={{ color: colors.foreground }}
                >
                    ~/project $
                </span>
                <span
                    className="font-mono text-xs"
                    style={{ color: colors.ansi.green }}
                >
                    {" "}git status
                </span>
            </div>
            {/* Swatch row */}
            <div className="mb-2 flex gap-1">
                {swatches.map((color, i) => (
                    <div
                        key={i}
                        className="h-3 flex-1 rounded-sm"
                        style={{ backgroundColor: color }}
                    />
                ))}
            </div>
            {/* Name + badge */}
            <div className="flex items-center gap-2">
                <span className="truncate text-sm font-medium">{source.name}</span>
                {source.origin !== "bundled" && (
                    <span className="text-muted-foreground bg-muted rounded px-1.5 py-0.5 text-[10px]">
                        {source.origin}
                    </span>
                )}
            </div>
        </button>
    );
}

export { ThemeCard };
