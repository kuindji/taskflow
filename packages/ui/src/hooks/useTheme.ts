import { useEffect } from "react";
import { useThemeStore } from "../stores/theme-store";
import { updateMonacoTheme } from "../lib/monaco-theme";

function useTheme(): void {
    // resolved is never null — theme store eagerly resolves the default theme
    const resolved = useThemeStore((s) => s.resolved);

    useEffect(() => {
        // Apply CSS variables to document root
        const root = document.documentElement;
        for (const [key, value] of Object.entries(resolved.css) as [string, string][]) {
            root.style.setProperty(key, value);
        }

        // Update Monaco theme
        updateMonacoTheme(resolved);
    }, [resolved]);
}

export { useTheme };
