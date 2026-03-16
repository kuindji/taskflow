export interface AnsiColors {
    black: string;
    red: string;
    green: string;
    yellow: string;
    blue: string;
    magenta: string;
    cyan: string;
    white: string;
    brightBlack: string;
    brightRed: string;
    brightGreen: string;
    brightYellow: string;
    brightBlue: string;
    brightMagenta: string;
    brightCyan: string;
    brightWhite: string;
}

export interface ThemeColors {
    foreground: string;
    background: string;
    cursor: string;
    cursorText: string;
    selection: string;
    selectionText: string;
    ansi: AnsiColors;
}

export type ThemeOrigin = "bundled" | "imported" | "custom";

export interface ThemeSource {
    version: 1;
    name: string;
    author?: string;
    origin: ThemeOrigin;
    colors: ThemeColors;
    overrides?: Partial<CssVariables>;
}

export interface ThemeRecord {
    id: string;
    source: ThemeSource;
}

export interface CssVariables {
    "--background": string;
    "--foreground": string;
    "--card": string;
    "--card-foreground": string;
    "--popover": string;
    "--popover-foreground": string;
    "--primary": string;
    "--primary-foreground": string;
    "--secondary": string;
    "--secondary-foreground": string;
    "--accent": string;
    "--accent-foreground": string;
    "--muted": string;
    "--muted-foreground": string;
    "--destructive": string;
    "--destructive-foreground": string;
    "--success": string;
    "--success-foreground": string;
    "--warning": string;
    "--warning-foreground": string;
    "--info": string;
    "--info-foreground": string;
    "--border": string;
    "--input": string;
    "--ring": string;
    "--island-base": string;
    "--chart-1": string;
    "--chart-2": string;
    "--chart-3": string;
    "--chart-4": string;
    "--chart-5": string;
    "--sidebar-background": string;
    "--sidebar-foreground": string;
    "--sidebar-primary": string;
    "--sidebar-primary-foreground": string;
    "--sidebar-accent": string;
    "--sidebar-accent-foreground": string;
    "--sidebar-border": string;
    "--sidebar-ring": string;
}

export interface XtermTheme {
    background: string;
    foreground: string;
    cursor: string;
    cursorAccent: string;
    selectionBackground: string;
    black: string;
    red: string;
    green: string;
    yellow: string;
    blue: string;
    magenta: string;
    cyan: string;
    white: string;
    brightBlack: string;
    brightRed: string;
    brightGreen: string;
    brightYellow: string;
    brightBlue: string;
    brightMagenta: string;
    brightCyan: string;
    brightWhite: string;
}

export interface ResolvedTheme {
    source: ThemeSource;
    css: CssVariables;
    xterm: XtermTheme;
    // Monaco theme rules are built in UI-only code (monaco-theme.ts)
}
