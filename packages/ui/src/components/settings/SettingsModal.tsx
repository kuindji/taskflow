import { useCallback } from "react";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { useUIStore } from "@/stores/ui-store";
import { useSettingsStore } from "@/stores/settings-store";
import { FontFamilySelect } from "./FontFamilySelect";

const EDITOR_OPTIONS = [
    { value: "system", label: "System Default" },
    { value: "vscode", label: "VS Code" },
    { value: "cursor", label: "Cursor" },
    { value: "windsurf", label: "Windsurf" },
    { value: "zed", label: "Zed" },
    { value: "sublime", label: "Sublime Text" },
    { value: "webstorm", label: "WebStorm" },
    { value: "idea", label: "IntelliJ IDEA" },
    { value: "emacs", label: "Emacs" },
] as const;

function SettingsModal() {
    const open = useUIStore((s) => s.settingsOpen);
    const toggleSettings = useUIStore((s) => s.toggleSettings);
    const settings = useSettingsStore((s) => s.settings);
    const updateSettings = useSettingsStore((s) => s.updateSettings);

    const handleOpenChange = useCallback(
        (value: boolean) => {
            if (!value) toggleSettings();
        },
        [toggleSettings],
    );

    const handleGeneralFontFamily = useCallback(
        (fontFamily: string) => {
            void updateSettings({ general: { fontFamily } });
        },
        [updateSettings],
    );

    const handleGeneralFontSize = useCallback(
        (e: React.ChangeEvent<HTMLInputElement>) => {
            const fontSize = parseInt(e.target.value, 10);
            if (!isNaN(fontSize) && fontSize > 0) {
                void updateSettings({ general: { fontSize } });
            }
        },
        [updateSettings],
    );

    const handleTerminalFontFamily = useCallback(
        (fontFamily: string) => {
            void updateSettings({ terminal: { fontFamily } });
        },
        [updateSettings],
    );

    const handleTerminalFontSize = useCallback(
        (e: React.ChangeEvent<HTMLInputElement>) => {
            const fontSize = parseInt(e.target.value, 10);
            if (!isNaN(fontSize) && fontSize > 0) {
                void updateSettings({ terminal: { fontSize } });
            }
        },
        [updateSettings],
    );

    const handleEditorFontFamily = useCallback(
        (fontFamily: string) => {
            void updateSettings({ editor: { fontFamily } });
        },
        [updateSettings],
    );

    const handleEditorFontSize = useCallback(
        (e: React.ChangeEvent<HTMLInputElement>) => {
            const fontSize = parseInt(e.target.value, 10);
            if (!isNaN(fontSize) && fontSize > 0) {
                void updateSettings({ editor: { fontSize } });
            }
        },
        [updateSettings],
    );

    const handleExternalEditor = useCallback(
        (externalEditor: string) => {
            void updateSettings({ general: { externalEditor } });
        },
        [updateSettings],
    );

    if (!settings) return null;

    return (
        <Dialog open={open} onOpenChange={handleOpenChange}>
            <DialogContent className="w-[min(42rem,calc(100vw-2rem))] max-w-[calc(100vw-2rem)] sm:max-w-[42rem]">
                <DialogHeader>
                    <DialogTitle>Settings</DialogTitle>
                    <DialogDescription>
                        Changes apply immediately.
                    </DialogDescription>
                </DialogHeader>
                <div className="space-y-6">
                    <section className="space-y-3">
                        <h3 className="text-sm font-medium">External Editor</h3>
                        <div className="space-y-1">
                            <Label className="text-xs text-muted-foreground">
                                Used when opening files with Cmd+Click in the terminal
                            </Label>
                            <Select
                                value={settings.general.externalEditor}
                                onValueChange={handleExternalEditor}
                            >
                                <SelectTrigger className="w-full h-8 text-sm">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    {EDITOR_OPTIONS.map((opt) => (
                                        <SelectItem key={opt.value} value={opt.value}>
                                            {opt.label}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                    </section>
                    <section className="space-y-3">
                        <h3 className="text-sm font-medium">Application Font</h3>
                        <div className="grid items-center gap-3 sm:grid-cols-[minmax(0,1fr)_80px]">
                            <div className="min-w-0 space-y-1">
                                <Label className="text-xs text-muted-foreground">Family</Label>
                                <FontFamilySelect
                                    value={settings.general.fontFamily}
                                    onChange={handleGeneralFontFamily}
                                />
                            </div>
                            <div className="space-y-1">
                                <Label className="text-xs text-muted-foreground">Size</Label>
                                <Input
                                    type="number"
                                    min={8}
                                    max={32}
                                    value={settings.general.fontSize}
                                    onChange={handleGeneralFontSize}
                                    className="h-8 text-sm"
                                />
                            </div>
                        </div>
                    </section>
                    <section className="space-y-3">
                        <h3 className="text-sm font-medium">Terminal Font</h3>
                        <div className="grid items-center gap-3 sm:grid-cols-[minmax(0,1fr)_80px]">
                            <div className="min-w-0 space-y-1">
                                <Label className="text-xs text-muted-foreground">Family</Label>
                                <FontFamilySelect
                                    value={settings.terminal.fontFamily}
                                    onChange={handleTerminalFontFamily}
                                />
                            </div>
                            <div className="space-y-1">
                                <Label className="text-xs text-muted-foreground">Size</Label>
                                <Input
                                    type="number"
                                    min={8}
                                    max={32}
                                    value={settings.terminal.fontSize}
                                    onChange={handleTerminalFontSize}
                                    className="h-8 text-sm"
                                />
                            </div>
                        </div>
                    </section>
                    <section className="space-y-3">
                        <h3 className="text-sm font-medium">Editor Font</h3>
                        <div className="grid items-center gap-3 sm:grid-cols-[minmax(0,1fr)_80px]">
                            <div className="min-w-0 space-y-1">
                                <Label className="text-xs text-muted-foreground">Family</Label>
                                <FontFamilySelect
                                    value={settings.editor.fontFamily}
                                    onChange={handleEditorFontFamily}
                                />
                            </div>
                            <div className="space-y-1">
                                <Label className="text-xs text-muted-foreground">Size</Label>
                                <Input
                                    type="number"
                                    min={8}
                                    max={32}
                                    value={settings.editor.fontSize}
                                    onChange={handleEditorFontSize}
                                    className="h-8 text-sm"
                                />
                            </div>
                        </div>
                    </section>
                </div>
            </DialogContent>
        </Dialog>
    );
}

export { SettingsModal };
