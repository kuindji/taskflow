import type { ThemeRecord, ThemeSource } from "../types/theme";

import catppuccinMocha from "./bundled/catppuccin-mocha.json";
import dracula from "./bundled/dracula.json";
import gruvboxDark from "./bundled/gruvbox-dark.json";
import tokyoNight from "./bundled/tokyo-night.json";
import ayu from "./bundled/ayu.json";
import deus from "./bundled/deus.json";
import iceberg from "./bundled/iceberg.json";
import kanagawa from "./bundled/kanagawa.json";
import nightOwl from "./bundled/night-owl.json";
import nordic from "./bundled/nordic.json";
import oneDark from "./bundled/one-dark.json";
import posterpole from "./bundled/posterpole.json";
import rosePine from "./bundled/rose-pine.json";
import sonokai from "./bundled/sonokai.json";

// JSON imports widen literal types (version: number, origin: string).
// This narrows them back to the ThemeSource literal types.
function asSource(json: {
    version: number;
    name: string;
    origin: string;
    colors: Record<string, unknown>;
}): ThemeSource {
    return json as unknown as ThemeSource;
}

export const bundledThemes: ThemeRecord[] = [
    { id: "ayu", source: asSource(ayu) },
    { id: "catppuccin-mocha", source: asSource(catppuccinMocha) },
    { id: "deus", source: asSource(deus) },
    { id: "dracula", source: asSource(dracula) },
    { id: "gruvbox-dark", source: asSource(gruvboxDark) },
    { id: "iceberg", source: asSource(iceberg) },
    { id: "kanagawa", source: asSource(kanagawa) },
    { id: "night-owl", source: asSource(nightOwl) },
    { id: "nordic", source: asSource(nordic) },
    { id: "one-dark", source: asSource(oneDark) },
    { id: "posterpole", source: asSource(posterpole) },
    { id: "rose-pine", source: asSource(rosePine) },
    { id: "sonokai", source: asSource(sonokai) },
    { id: "tokyo-night", source: asSource(tokyoNight) },
];
