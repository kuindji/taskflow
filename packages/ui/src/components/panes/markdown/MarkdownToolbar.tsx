import { Eye, Pencil } from "lucide-react";
import { Toolbar } from "@/components/ui/toolbar";
import { Button } from "@/components/ui/button";

interface MarkdownToolbarProps {
    mode: "preview" | "edit";
    onToggleMode: () => void;
}

function MarkdownToolbar({ mode, onToggleMode }: MarkdownToolbarProps) {
    return (
        <Toolbar className="justify-end gap-1">
            <Button
                variant="ghost"
                size="icon-xs"
                onClick={onToggleMode}
                aria-label={mode === "preview" ? "Edit" : "Preview"}
                tooltip={mode === "preview" ? "Edit" : "Preview"}
                tooltipSide="bottom">
                {mode === "preview" ? <Pencil className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </Button>
        </Toolbar>
    );
}

export { MarkdownToolbar };
