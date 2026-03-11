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
import { useUIStore } from "@/stores/ui-store";
import { useSettingsStore } from "@/stores/settings-store";
import { FontFamilySelect } from "./FontFamilySelect";

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

    if (!settings) return null;

    return (
        <Dialog open={open} onOpenChange={handleOpenChange}>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle>Settings</DialogTitle>
                    <DialogDescription>
                        Changes apply immediately.
                    </DialogDescription>
                </DialogHeader>
                <div className="space-y-6">
                    <section className="space-y-3">
                        <h3 className="text-sm font-medium">Application Font</h3>
                        <div className="grid grid-cols-[1fr_80px] gap-3 items-center">
                            <div className="space-y-1">
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
                        <div className="grid grid-cols-[1fr_80px] gap-3 items-center">
                            <div className="space-y-1">
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
                </div>
            </DialogContent>
        </Dialog>
    );
}

export { SettingsModal };
