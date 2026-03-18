import { useThemeStore } from "@/stores/theme-store";
import { ThemeCard } from "./ThemeCard";

function ThemeGrid() {
    const themes = useThemeStore((s) => s.themes);
    const activeThemeId = useThemeStore((s) => s.activeThemeId);
    const activateTheme = useThemeStore((s) => s.activateTheme);
    const deleteTheme = useThemeStore((s) => s.deleteTheme);

    return (
        <div className="flex flex-col gap-3">
            {themes.length === 0 ? (
                <p className="text-muted-foreground py-6 text-center text-sm">
                    No themes installed.
                </p>
            ) : (
                <div className="grid grid-cols-2 gap-3">
                    {themes.map((theme) => (
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
