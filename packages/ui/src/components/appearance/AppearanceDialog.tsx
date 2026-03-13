import { useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useUIStore } from "@/stores/ui-store";
import { useThemeStore } from "@/stores/theme-store";
import { ThemeGrid } from "./ThemeGrid";
import { ImportTab } from "./ImportTab";
import { BrowseOnlineTab } from "./BrowseOnlineTab";

function AppearanceDialog() {
    const open = useUIStore((s) => s.appearanceOpen);
    const setAppearanceOpen = useUIStore((s) => s.setAppearanceOpen);
    const fetchThemes = useThemeStore((s) => s.fetchThemes);

    useEffect(() => {
        if (open) {
            void fetchThemes({ preferredThemeId: useThemeStore.getState().activeThemeId });
        }
    }, [open, fetchThemes]);

    return (
        <Dialog open={open} onOpenChange={setAppearanceOpen}>
            <DialogContent className="flex max-h-[80vh] max-w-2xl flex-col overflow-hidden">
                <DialogHeader>
                    <DialogTitle>Appearance</DialogTitle>
                </DialogHeader>
                <Tabs defaultValue="themes" className="flex flex-1 flex-col overflow-hidden">
                    <TabsList className="w-fit">
                        <TabsTrigger value="themes">Themes</TabsTrigger>
                        <TabsTrigger value="import">Import</TabsTrigger>
                        <TabsTrigger value="browse">Browse Online</TabsTrigger>
                    </TabsList>
                    <TabsContent value="themes" className="mt-4 flex-1 overflow-y-auto">
                        <ThemeGrid />
                    </TabsContent>
                    <TabsContent value="import" className="mt-4 flex-1 overflow-y-auto">
                        <ImportTab />
                    </TabsContent>
                    <TabsContent value="browse" className="mt-4 flex-1 overflow-y-auto">
                        <BrowseOnlineTab />
                    </TabsContent>
                </Tabs>
            </DialogContent>
        </Dialog>
    );
}

export { AppearanceDialog };
