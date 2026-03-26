import { useCallback } from "react";
import { RotateCcw } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useSettingsStore } from "@/stores/settings-store";
import { FontFamilySelect } from "@/components/settings/FontFamilySelect";

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

    const handleResetAll = useCallback(() => {
        void updateSettings({
            general: { fontFamily: null, fontSize: null },
            terminal: { fontFamily: null, fontSize: null },
            editor: { fontFamily: null, fontSize: null },
        });
    }, [updateSettings]);

    if (!settings) return null;

    return (
        <div className="flex flex-col">
            <div className="hover:bg-island-base mx-1 rounded-md px-5 py-2.5 transition-colors">
                <div className="text-muted-foreground mb-2 text-[11px] font-medium tracking-wider uppercase">
                    Application
                </div>
                <div className="flex items-center gap-3">
                    <span className="text-secondary-foreground shrink-0 text-[13px] font-medium">
                        Family
                    </span>
                    <div className="min-w-0 flex-1">
                        <FontFamilySelect
                            value={settings.general.fontFamily}
                            onChange={handleGeneralFontFamily}
                        />
                    </div>
                    <Input
                        type="number"
                        min={8}
                        max={32}
                        value={settings.general.fontSize}
                        onChange={handleGeneralFontSize}
                        className="h-8 w-[80px] shrink-0 text-sm"
                    />
                </div>
            </div>

            <div className="hover:bg-island-base mx-1 rounded-md px-5 py-2.5 transition-colors">
                <div className="text-muted-foreground mb-2 text-[11px] font-medium tracking-wider uppercase">
                    Terminal
                </div>
                <div className="flex items-center gap-3">
                    <span className="text-secondary-foreground shrink-0 text-[13px] font-medium">
                        Family
                    </span>
                    <div className="min-w-0 flex-1">
                        <FontFamilySelect
                            value={settings.terminal.fontFamily}
                            onChange={handleTerminalFontFamily}
                        />
                    </div>
                    <Input
                        type="number"
                        min={8}
                        max={32}
                        value={settings.terminal.fontSize}
                        onChange={handleTerminalFontSize}
                        className="h-8 w-[80px] shrink-0 text-sm"
                    />
                </div>
            </div>

            <div className="hover:bg-island-base mx-1 rounded-md px-5 py-2.5 transition-colors">
                <div className="text-muted-foreground mb-2 text-[11px] font-medium tracking-wider uppercase">
                    Editor
                </div>
                <div className="flex items-center gap-3">
                    <span className="text-secondary-foreground shrink-0 text-[13px] font-medium">
                        Family
                    </span>
                    <div className="min-w-0 flex-1">
                        <FontFamilySelect
                            value={settings.editor.fontFamily}
                            onChange={handleEditorFontFamily}
                        />
                    </div>
                    <Input
                        type="number"
                        min={8}
                        max={32}
                        value={settings.editor.fontSize}
                        onChange={handleEditorFontSize}
                        className="h-8 w-[80px] shrink-0 text-sm"
                    />
                </div>
            </div>

            <div className="mx-1 mt-1 px-5 py-2">
                <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleResetAll}
                    className="text-muted-foreground hover:text-foreground h-7 gap-1.5 px-2 text-xs"
                >
                    <RotateCcw className="h-3 w-3" />
                    Reset to defaults
                </Button>
            </div>
        </div>
    );
}

export { FontsTab };
