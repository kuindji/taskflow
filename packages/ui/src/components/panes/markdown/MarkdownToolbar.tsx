import { ArrowLeft, ArrowRight, Eye, Pencil } from "lucide-react";
import { Toolbar } from "@/components/ui/toolbar";
import { Button } from "@/components/ui/button";

interface MarkdownToolbarProps {
    mode: "preview" | "edit";
    canGoBack: boolean;
    canGoForward: boolean;
    onBack: () => void;
    onForward: () => void;
    onToggleMode: () => void;
}

function MarkdownToolbar({
    mode,
    canGoBack,
    canGoForward,
    onBack,
    onForward,
    onToggleMode,
}: MarkdownToolbarProps) {
    return (
        <Toolbar className="gap-1">
            <Button
                variant="ghost"
                size="icon-xs"
                disabled={!canGoBack}
                onClick={onBack}
                aria-label="Back"
                tooltip="Back"
                tooltipSide="bottom">
                <ArrowLeft className="h-4 w-4" />
            </Button>
            <Button
                variant="ghost"
                size="icon-xs"
                disabled={!canGoForward}
                onClick={onForward}
                aria-label="Forward"
                tooltip="Forward"
                tooltipSide="bottom">
                <ArrowRight className="h-4 w-4" />
            </Button>
            <div className="flex-1" />
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
