import type { ThemeSource, ResolvedTheme, CssVariables, XtermTheme } from "../types/theme";
import { hexToRgba } from "./color-utils";

export function deriveTheme(source: ThemeSource): ResolvedTheme {
    const { colors } = source;
    const { ansi } = colors;

    const derived: CssVariables = {
        "--background": colors.background,
        "--foreground": colors.foreground,
        "--card": ansi.black,
        "--card-foreground": colors.foreground,
        "--popover": colors.selection,
        "--popover-foreground": colors.foreground,
        "--primary": colors.foreground,
        "--primary-foreground": colors.background,
        "--secondary": colors.selection,
        "--secondary-foreground": ansi.brightWhite,
        "--accent": ansi.blue,
        "--accent-foreground": colors.background,
        "--muted": colors.selection,
        "--muted-foreground": ansi.brightBlack,
        "--destructive": ansi.red,
        "--destructive-foreground": colors.background,
        "--success": ansi.green,
        "--success-foreground": colors.background,
        "--warning": ansi.yellow,
        "--warning-foreground": colors.background,
        "--info": ansi.blue,
        "--info-foreground": colors.background,
        "--border": colors.selection,
        "--input": colors.selection,
        "--ring": ansi.blue,
        "--island-base": hexToRgba(ansi.black, 0.5),
        "--chart-1": ansi.blue,
        "--chart-2": ansi.green,
        "--chart-3": ansi.yellow,
        "--chart-4": ansi.red,
        "--chart-5": ansi.magenta,
        "--sidebar-background": colors.background,
        "--sidebar-foreground": colors.foreground,
        "--sidebar-primary": colors.foreground,
        "--sidebar-primary-foreground": colors.background,
        "--sidebar-accent": ansi.blue,
        "--sidebar-accent-foreground": colors.background,
        "--sidebar-border": colors.selection,
        "--sidebar-ring": ansi.blue,
    };

    // Apply overrides — typed as Record<string, string>, so any CSS variable can be overridden
    const css: CssVariables = source.overrides
        ? { ...derived, ...(source.overrides as Partial<CssVariables>) }
        : derived;

    const xterm: XtermTheme = {
        background: colors.background,
        foreground: colors.foreground,
        cursor: colors.cursor,
        cursorAccent: colors.cursorText,
        selectionBackground: colors.selection,
        black: ansi.black,
        red: ansi.red,
        green: ansi.green,
        yellow: ansi.yellow,
        blue: ansi.blue,
        magenta: ansi.magenta,
        cyan: ansi.cyan,
        white: ansi.white,
        brightBlack: ansi.brightBlack,
        brightRed: ansi.brightRed,
        brightGreen: ansi.brightGreen,
        brightYellow: ansi.brightYellow,
        brightBlue: ansi.brightBlue,
        brightMagenta: ansi.brightMagenta,
        brightCyan: ansi.brightCyan,
        brightWhite: ansi.brightWhite,
    };

    return { source, css, xterm };
}
