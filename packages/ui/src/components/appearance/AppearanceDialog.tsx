import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useUIStore } from "@/stores/ui-store";
import { useThemeStore } from "@/stores/theme-store";
import { ThemeGrid } from "./ThemeGrid";
import { ImportTab } from "./ImportTab";
import { FontsTab } from "./FontsTab";

type Section = "themes" | "import" | "fonts";

const navItems: { key: Section; label: string }[] = [
    { key: "themes", label: "Themes" },
    { key: "import", label: "Import theme" },
    { key: "fonts", label: "Fonts" },
];

function AppearanceDialog() {
    const open = useUIStore((s) => s.appearanceOpen);
    const setAppearanceOpen = useUIStore((s) => s.setAppearanceOpen);
    const fetchThemes = useThemeStore((s) => s.fetchThemes);
    const [section, setSection] = useState<Section>("themes");

    useEffect(() => {
        if (open) {
            void fetchThemes({ preferredThemeId: useThemeStore.getState().activeThemeId });
        }
    }, [open, fetchThemes]);

    return (
        <Dialog open={open} onOpenChange={setAppearanceOpen}>
            <DialogContent
                className="bg-dialog-shell border-border flex max-h-[80vh] max-w-2xl flex-col gap-0 overflow-hidden rounded-xl p-1.5"
                aria-describedby={undefined}>
                <DialogHeader className="px-2 py-2">
                    <DialogTitle className="text-[15px]">Appearance</DialogTitle>
                </DialogHeader>

                <div className="flex flex-1 gap-1.5 overflow-hidden">
                    {/* Sidebar */}
                    <nav className="bg-card w-[148px] shrink-0 rounded-[10px] p-1.5">
                        {navItems.map((item) => (
                            <button
                                key={item.key}
                                className={`mb-px block w-full rounded-md px-3 py-[7px] text-left text-[13px] transition-colors ${
                                    section === item.key
                                        ? "bg-muted text-foreground font-medium"
                                        : "text-muted-foreground hover:text-secondary-foreground hover:bg-muted/50"
                                }`}
                                onClick={() => setSection(item.key)}>
                                {item.label}
                            </button>
                        ))}
                    </nav>

                    {/* Content */}
                    <div className="bg-background min-w-0 flex-1 overflow-y-auto rounded-[10px]">
                        {section === "themes" && (
                            <div className="h-[360px] px-5 py-4">
                                <ThemeGrid />
                            </div>
                        )}
                        {section === "import" && (
                            <div className="h-[360px] py-1">
                                <ImportTab />
                            </div>
                        )}
                        {section === "fonts" && (
                            <div className="h-[360px] py-1">
                                <FontsTab />
                            </div>
                        )}
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    );
}

export { AppearanceDialog };
