import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
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
        <div className="flex flex-col gap-4 px-5 py-2.5">
            <div className="flex items-center justify-between">
                <p className="text-muted-foreground text-sm">
                    Import themes from your terminal apps or files.
                </p>
                <Button
                    variant="outline"
                    size="sm"
                    onClick={handleFileImport}
                    disabled={importing === "file"}>
                    {importing === "file" ? "Importing..." : "From File..."}
                </Button>
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
                                    className="border-border/50 flex items-center justify-between rounded-md border px-3 py-2">
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
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={() => handleImportTheme(theme, key)}
                                        disabled={importing === key}>
                                        {importing === key ? "Importing..." : "Import"}
                                    </Button>
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
