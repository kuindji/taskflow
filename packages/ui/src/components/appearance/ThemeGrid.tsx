import { useState, useMemo } from "react";
import { useThemeStore } from "@/stores/theme-store";
import { ThemeCard } from "./ThemeCard";

function ThemeGrid() {
    const themes = useThemeStore((s) => s.themes);
    const activeThemeId = useThemeStore((s) => s.activeThemeId);
    const activateTheme = useThemeStore((s) => s.activateTheme);
    const deleteTheme = useThemeStore((s) => s.deleteTheme);
    const [search, setSearch] = useState("");

    const filtered = useMemo(() => {
        const q = search.toLowerCase().trim();
        if (!q) return themes;
        return themes.filter(
            (t) =>
                t.source.name.toLowerCase().includes(q) ||
                t.source.author?.toLowerCase().includes(q),
        );
    }, [themes, search]);

    return (
        <div className="flex flex-col gap-3">
            <input
                type="text"
                placeholder="Search themes..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="rounded-md border border-border/50 bg-background px-3 py-1.5 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-accent"
                aria-label="Search themes"
            />
            {filtered.length === 0 ? (
                <p className="text-muted-foreground py-6 text-center text-sm">
                    {search ? "No themes match your search." : "No themes installed."}
                </p>
            ) : (
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
            )}
        </div>
    );
}

export { ThemeGrid };
