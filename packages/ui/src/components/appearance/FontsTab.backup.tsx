import { useCallback } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useSettingsStore } from "@/stores/settings-store";
import { FontFamilySelect } from "@/components/settings/FontFamilySelect";

const labelClassName = "block text-xxs text-muted-foreground";

function FontsTab() {
    const settings = useSettingsStore((s) => s.settings);
    const updateSettings = useSettingsStore((s) => s.updateSettings);

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

    if (!settings) return null;

    return (
        <div className="space-y-4">
            <section className="space-y-2">
                <h3 className="mb-0 text-sm font-medium">Application Font</h3>
                <div className="grid items-center gap-3 sm:grid-cols-[minmax(0,1fr)_80px]">
                    <div className="min-w-0 space-y-1">
                        <Label className={labelClassName}>Family</Label>
                        <FontFamilySelect
                            value={settings.general.fontFamily}
                            onChange={handleGeneralFontFamily}
                        />
                    </div>
                    <div className="space-y-1">
                        <Label className={labelClassName}>Size</Label>
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
            <section className="space-y-2">
                <h3 className="mb-0 text-sm font-medium">Terminal Font</h3>
                <div className="grid items-center gap-3 sm:grid-cols-[minmax(0,1fr)_80px]">
                    <div className="min-w-0 space-y-1">
                        <Label className={labelClassName}>Family</Label>
                        <FontFamilySelect
                            value={settings.terminal.fontFamily}
                            onChange={handleTerminalFontFamily}
                        />
                    </div>
                    <div className="space-y-1">
                        <Label className={labelClassName}>Size</Label>
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
            <section className="space-y-2">
                <h3 className="mb-0 text-sm font-medium">Editor Font</h3>
                <div className="grid items-center gap-3 sm:grid-cols-[minmax(0,1fr)_80px]">
                    <div className="min-w-0 space-y-1">
                        <Label className={labelClassName}>Family</Label>
                        <FontFamilySelect
                            value={settings.editor.fontFamily}
                            onChange={handleEditorFontFamily}
                        />
                    </div>
                    <div className="space-y-1">
                        <Label className={labelClassName}>Size</Label>
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
    );
}

export { FontsTab };
