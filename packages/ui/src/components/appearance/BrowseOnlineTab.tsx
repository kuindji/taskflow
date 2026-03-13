import { useEffect, useState } from "react";
import { useThemeStore } from "../../stores/theme-store";
import type { OnlineThemeRecord } from "@taskflow/shared";

function ThemePreviewCard({
    theme,
    onDownload,
    downloading,
}: {
    theme: OnlineThemeRecord;
    onDownload: () => void;
    downloading: boolean;
}) {
    const { preview } = theme;

    return (
        <div className="flex flex-col gap-2 rounded-lg border border-border/50 p-3">
            {/* Preview swatch */}
            <div
                className="flex items-end gap-1 rounded-md p-3 h-16"
                style={{ backgroundColor: preview.background }}
                aria-hidden
            >
                <span style={{ color: preview.foreground, fontSize: "11px", fontFamily: "monospace" }}>
                    {theme.name}
                </span>
            </div>

            {/* Color dots */}
            <div className="flex gap-1">
                {[
                    preview.ansi.red,
                    preview.ansi.green,
                    preview.ansi.yellow,
                    preview.ansi.blue,
                    preview.ansi.magenta,
                    preview.ansi.cyan,
                ].map((color, i) => (
                    <div
                        key={i}
                        className="h-3 w-3 rounded-full"
                        style={{ backgroundColor: color }}
                        aria-hidden
                    />
                ))}
            </div>

            {/* Info + action */}
            <div className="flex items-center justify-between">
                <div className="flex flex-col">
                    <span className="text-sm font-medium">{theme.name}</span>
                    {theme.author && (
                        <span className="text-xs text-muted-foreground">{theme.author}</span>
                    )}
                </div>
                {theme.installed ? (
                    <span className="text-xs text-muted-foreground">Installed</span>
                ) : (
                    <button
                        type="button"
                        className="rounded-md bg-accent/10 px-2 py-1 text-xs font-medium text-accent hover:bg-accent/20 transition-colors disabled:opacity-50"
                        onClick={onDownload}
                        disabled={downloading}
                    >
                        {downloading ? "Installing..." : "Install"}
                    </button>
                )}
            </div>
        </div>
    );
}

function BrowseOnlineTab() {
    const onlineThemes = useThemeStore((s) => s.onlineThemes);
    const browsingOnline = useThemeStore((s) => s.browsingOnline);
    const fetchOnlineThemes = useThemeStore((s) => s.fetchOnlineThemes);
    const downloadOnlineTheme = useThemeStore((s) => s.downloadOnlineTheme);
    const [downloading, setDownloading] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;

        void (async () => {
            setError(null);
            try {
                await fetchOnlineThemes();
            } catch {
                if (!cancelled) {
                    setError("Failed to load online themes. Please try again.");
                }
            }
        })();

        return () => {
            cancelled = true;
        };
    }, [fetchOnlineThemes]);

    async function handleDownload(theme: OnlineThemeRecord) {
        setDownloading(theme.id);
        setError(null);
        try {
            await downloadOnlineTheme(theme);
        } catch {
            setError(`Failed to install "${theme.name}". Please try again.`);
            setDownloading(null);
            return;
        }

        try {
            await fetchOnlineThemes();
        } catch {
            setError(`Installed "${theme.name}", but failed to refresh the online list.`);
        } finally {
            setDownloading(null);
        }
    }

    return (
        <div className="flex flex-col gap-4">
            <p className="text-muted-foreground text-sm">
                Browse and install themes from terminalcolors.com.
            </p>

            {error && (
                <p className="text-destructive text-xs">{error}</p>
            )}

            {browsingOnline && (
                <p className="text-muted-foreground text-xs animate-pulse">
                    Loading themes...
                </p>
            )}

            {!browsingOnline && !error && onlineThemes.length === 0 && (
                <p className="text-muted-foreground text-xs">
                    No online themes available.
                </p>
            )}

            {onlineThemes.length > 0 && (
                <div className="grid grid-cols-2 gap-3">
                    {onlineThemes.map((theme) => (
                        <ThemePreviewCard
                            key={theme.id}
                            theme={theme}
                            onDownload={() => handleDownload(theme)}
                            downloading={downloading === theme.id}
                        />
                    ))}
                </div>
            )}
        </div>
    );
}

export { BrowseOnlineTab };
