import * as React from "react";
import { useState, useCallback } from "react";
import { Maximize2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Textarea } from "@/components/ui/textarea";
import { MonacoEditorDialog } from "@/components/ui/monaco-editor-dialog";

interface ExpandableTextareaProps extends React.ComponentProps<"textarea"> {
    dialogTitle?: string;
}

const ExpandableTextarea = React.forwardRef<HTMLTextAreaElement, ExpandableTextareaProps>(
    ({ className, dialogTitle, onChange, value, ...props }, ref) => {
        const [editorOpen, setEditorOpen] = useState(false);

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
                        className={cn("pr-8", className)}
                        value={value}
                        onChange={onChange}
                        {...props}
                    />
                    <button
                        type="button"
                        className="text-muted-foreground hover:text-foreground absolute top-1.5 right-1.5 rounded-sm p-0.5 opacity-60 transition-opacity hover:opacity-100"
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
