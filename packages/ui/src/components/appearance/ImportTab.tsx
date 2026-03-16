import { useEffect, useState } from "react";
import { useThemeStore } from "../../stores/theme-store";
import type { ThemeSource } from "@taskflow/shared";

function ImportTab() {
    const scannedApps = useThemeStore((s) => s.scannedApps);
    const scanning = useThemeStore((s) => s.scanning);
    const scanTerminalApps = useThemeStore((s) => s.scanTerminalApps);
    const importTheme = useThemeStore((s) => s.importTheme);
    const importThemeFile = useThemeStore((s) => s.importThemeFile);
    const [importing, setImporting] = useState<string | null>(null);

    useEffect(() => {
        void scanTerminalApps();
    }, [scanTerminalApps]);

    async function handleImportTheme(theme: ThemeSource, key: string) {
        setImporting(key);
        try {
            await importTheme(theme);
        } finally {
            setImporting(null);
        }
    }

    async function handleFileImport() {
        const path = await window.taskflow?.selectThemeFile();
        if (!path) return;
        setImporting("file");
        try {
            await importThemeFile(path);
        } finally {
            setImporting(null);
        }
    }

    return (
        <div className="flex flex-col gap-4">
            <div className="flex items-center justify-between">
                <p className="text-muted-foreground text-sm">
                    Import themes from your terminal apps or files.
                </p>
                <button
                    type="button"
                    className="bg-accent/10 text-accent hover:bg-accent/20 rounded-md px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-50"
                    onClick={handleFileImport}
                    disabled={importing === "file"}
                >
                    {importing === "file" ? "Importing..." : "From File..."}
                </button>
            </div>

            {scanning && (
                <p className="text-muted-foreground animate-pulse text-xs">
                    Scanning for terminal apps...
                </p>
            )}

            {!scanning && scannedApps.length === 0 && (
                <p className="text-muted-foreground text-xs">
                    No importable themes found from installed terminal apps.
                </p>
            )}

            {scannedApps.map(({ app, themes }) => (
                <div key={app} className="flex flex-col gap-2">
                    <h3 className="text-sm font-medium">{app}</h3>
                    <div className="flex flex-col gap-1">
                        {themes.map((theme, idx) => {
                            const key = `${app}-${idx}`;
                            return (
                                <div
                                    key={key}
                                    className="border-border/50 flex items-center justify-between rounded-md border px-3 py-2"
                                >
                                    <div className="flex items-center gap-3">
                                        <div className="flex gap-1">
                                            {[
                                                theme.colors.ansi.red,
                                                theme.colors.ansi.green,
                                                theme.colors.ansi.blue,
                                                theme.colors.ansi.yellow,
                                                theme.colors.ansi.magenta,
                                                theme.colors.ansi.cyan,
                                            ].map((color, i) => (
                                                <div
                                                    key={i}
                                                    className="h-3 w-3 rounded-full"
                                                    style={{ backgroundColor: color }}
                                                    aria-hidden
                                                />
                                            ))}
                                        </div>
                                        <span className="text-sm">{theme.name}</span>
                                    </div>
                                    <button
                                        type="button"
                                        className="bg-accent/10 text-accent hover:bg-accent/20 rounded-md px-2 py-1 text-xs font-medium transition-colors disabled:opacity-50"
                                        onClick={() => handleImportTheme(theme, key)}
                                        disabled={importing === key}
                                    >
                                        {importing === key ? "Importing..." : "Import"}
                                    </button>
                                </div>
                            );
                        })}
                    </div>
                </div>
            ))}
        </div>
    );
}

export { ImportTab };
