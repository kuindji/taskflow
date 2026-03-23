import * as React from "react";
import { useState, useCallback } from "react";
import { CircleHelp, Maximize2 } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { MonacoEditorDialog } from "@/components/ui/monaco-editor-dialog";
import { useUIStore } from "@/stores/ui-store";

interface ExpandableTextareaProps extends React.ComponentProps<"textarea"> {
    dialogTitle?: string;
}

const ExpandableTextarea = React.forwardRef<HTMLTextAreaElement, ExpandableTextareaProps>(
    ({ className, dialogTitle, onChange, value, ...props }, ref) => {
        const [editorOpen, setEditorOpen] = useState(false);
        const openAgentOperationsHelp = useUIStore((s) => s.openAgentOperationsHelp);

        const handleEditorClose = useCallback(
            (newValue: string) => {
                if (onChange) {
                    const syntheticEvent = {
                        target: { value: newValue },
                    } as React.ChangeEvent<HTMLTextAreaElement>;
                    onChange(syntheticEvent);
                }
            },
            [onChange],
        );

        return (
            <>
                <div className="relative">
                    <Textarea
                        ref={ref}
                        className={className}
                        value={value}
                        onChange={onChange}
                        {...props}
                    />
                    <button
                        type="button"
                        className="text-muted-foreground hover:text-foreground absolute -top-5.5 right-7 rounded-sm p-0.5 opacity-60 transition-opacity hover:opacity-100"
                        onClick={openAgentOperationsHelp}
                        tabIndex={-1}
                        aria-label="What agents can do">
                        <CircleHelp className="size-3.5" />
                    </button>
                    <button
                        type="button"
                        className="text-muted-foreground hover:text-foreground absolute -top-5.5 right-1.5 rounded-sm p-0.5 opacity-60 transition-opacity hover:opacity-100"
                        onClick={() => setEditorOpen(true)}
                        tabIndex={-1}
                        aria-label="Expand editor">
                        <Maximize2 className="size-3.5" />
                    </button>
                </div>
                <MonacoEditorDialog
                    open={editorOpen}
                    onOpenChange={setEditorOpen}
                    value={typeof value === "string" ? value : ""}
                    onClose={handleEditorClose}
                    title={dialogTitle}
                />
            </>
        );
    },
);

ExpandableTextarea.displayName = "ExpandableTextarea";

export { ExpandableTextarea };
