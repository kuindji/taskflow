import { ArrowLeft, ArrowRight, ExternalLink, Eye, PanelRight, Pencil } from "lucide-react";
import { Toolbar } from "@/components/ui/toolbar";
import { Button } from "@/components/ui/button";

interface MarkdownToolbarProps {
    mode: "preview" | "edit";
    canGoBack: boolean;
    canGoForward: boolean;
    onBack: () => void;
    onForward: () => void;
    onToggleMode: () => void;
    /** Only wiki pages get a rail, so only they get its toggle. */
    showRailToggle: boolean;
    railOpen: boolean;
    onToggleRail: () => void;
    /** True only when this page lives in a registered Obsidian vault. */
    canOpenInObsidian: boolean;
    onOpenInObsidian: () => void;
}

function MarkdownToolbar({
    mode,
    canGoBack,
    canGoForward,
    onBack,
    onForward,
    onToggleMode,
    showRailToggle,
    railOpen,
    onToggleRail,
    canOpenInObsidian,
    onOpenInObsidian,
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
            {canOpenInObsidian && (
                <Button
                    variant="ghost"
                    size="icon-xs"
                    onClick={onOpenInObsidian}
                    aria-label="Open in Obsidian"
                    tooltip="Open in Obsidian"
                    tooltipSide="bottom">
                    <ExternalLink className="h-4 w-4" />
                </Button>
            )}
            {showRailToggle && (
                <Button
                    variant={railOpen ? "secondary" : "ghost"}
                    size="icon-xs"
                    onClick={onToggleRail}
                    aria-pressed={railOpen}
                    aria-label={railOpen ? "Hide page context" : "Show page context"}
                    tooltip={railOpen ? "Hide page context" : "Show page context"}
                    tooltipSide="bottom">
                    <PanelRight className="h-4 w-4" />
                </Button>
            )}
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
