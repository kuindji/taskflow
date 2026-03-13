import type { ThemeRecord, ThemeSource } from "../types/theme";

import catppuccinMocha from "./bundled/catppuccin-mocha.json";
import dracula from "./bundled/dracula.json";
import nord from "./bundled/nord.json";
import gruvboxDark from "./bundled/gruvbox-dark.json";
import tokyoNight from "./bundled/tokyo-night.json";
import solarizedDark from "./bundled/solarized-dark.json";

// JSON imports widen literal types (version: number, origin: string).
// This narrows them back to the ThemeSource literal types.
function asSource(json: { version: number; name: string; origin: string; colors: Record<string, unknown> }): ThemeSource {
    return json as unknown as ThemeSource;
}

export const bundledThemes: ThemeRecord[] = [
    { id: "catppuccin-mocha", source: asSource(catppuccinMocha) },
    { id: "dracula", source: asSource(dracula) },
    { id: "nord", source: asSource(nord) },
    { id: "gruvbox-dark", source: asSource(gruvboxDark) },
    { id: "tokyo-night", source: asSource(tokyoNight) },
    { id: "solarized-dark", source: asSource(solarizedDark) },
];
