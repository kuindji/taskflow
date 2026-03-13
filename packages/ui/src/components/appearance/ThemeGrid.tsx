import { useState, useMemo } from "react";
import { useThemeStore } from "@/stores/theme-store";
import { ThemeCard } from "./ThemeCard";
import { Input } from "@/components/ui/input";

function ThemeGrid() {
    const themes = useThemeStore((s) => s.themes);
    const activeThemeId = useThemeStore((s) => s.activeThemeId);
    const activateTheme = useThemeStore((s) => s.activateTheme);
    const deleteTheme = useThemeStore((s) => s.deleteTheme);
    const [search, setSearch] = useState("");

    const filtered = useMemo(() => {
        if (!search) return themes;
        const lower = search.toLowerCase();
        return themes.filter((t) => t.source.name.toLowerCase().includes(lower));
    }, [themes, search]);

    return (
        <div className="flex flex-col gap-3">
            <Input
                placeholder="Search themes..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="h-8"
            />
            <div className="grid grid-cols-3 gap-3">
                {filtered.map((theme) => (
                    <ThemeCard
                        key={theme.id}
                        theme={theme}
                        isActive={theme.id === activeThemeId}
                        onClick={() => void activateTheme(theme.id)}
                        onDelete={
                            theme.source.origin !== "bundled"
                                ? () => void deleteTheme(theme.id)
                                : undefined
                        }
                    />
                ))}
            </div>
        </div>
    );
}

export { ThemeGrid };
