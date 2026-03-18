import { useState, useCallback } from "react";
import type { FlowInputDefinition } from "@taskflow/shared";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { FolderOpen } from "lucide-react";

interface FlowInputDialogProps {
    open: boolean;
    flowName: string;
    inputs: FlowInputDefinition[];
    onSubmit: (values: Record<string, string>) => void;
    onCancel: () => void;
}

function FlowInputDialog({ open, flowName, inputs, onSubmit, onCancel }: FlowInputDialogProps) {
    const [values, setValues] = useState<Record<string, string>>(() =>
        Object.fromEntries(inputs.map((input) => [input.id, ""])),
    );

    const updateValue = useCallback((id: string, value: string) => {
        setValues((prev) => ({ ...prev, [id]: value }));
    }, []);

    const handleFilePick = useCallback(
        async (id: string) => {
            const filePath = await window.taskflow?.selectFile?.();
            if (filePath) {
                updateValue(id, filePath);
            }
        },
        [updateValue],
    );

    const allFilled = inputs.every((input) => values[input.id]?.trim());

    const handleSubmit = useCallback(() => {
        if (allFilled) onSubmit(values);
    }, [allFilled, values, onSubmit]);

    return (
        <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onCancel()}>
            <DialogContent className="max-w-md">
                <DialogHeader>
                    <DialogTitle>Flow Input: {flowName}</DialogTitle>
                </DialogHeader>
                <div className="flex flex-col gap-4 py-2">
                    {inputs.map((input) => (
                        <div key={input.id} className="flex flex-col gap-1.5">
                            <Label htmlFor={`flow-input-${input.id}`}>{input.label}</Label>
                            <div className="flex gap-2">
                                <Input
                                    id={`flow-input-${input.id}`}
                                    value={values[input.id] ?? ""}
                                    onChange={(e) => updateValue(input.id, e.target.value)}
                                    placeholder={
                                        input.type === "filepath" ? "Select a file..." : ""
                                    }
                                    className="flex-1"
                                />
                                {input.type === "filepath" && (
                                    <Button
                                        variant="outline"
                                        size="icon"
                                        onClick={() => void handleFilePick(input.id)}
                                        title="Browse...">
                                        <FolderOpen className="h-4 w-4" />
                                    </Button>
                                )}
                            </div>
                        </div>
                    ))}
                </div>
                <DialogFooter>
                    <Button variant="secondary" onClick={onCancel}>
                        Cancel
                    </Button>
                    <Button onClick={handleSubmit} disabled={!allFilled}>
                        Start Flow
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

export { FlowInputDialog };
