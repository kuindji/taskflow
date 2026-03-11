import { useCallback, useEffect, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ArrowLeft, RotateCw } from "lucide-react";
import useIsElectron from "@/hooks/useIsElectron";
import { normalizeUrl } from "@/utils/url";

interface BrowserPaneProps {
    initialUrl: string;
}

function BrowserPane({ initialUrl }: BrowserPaneProps) {
    const isElectron = useIsElectron();
    const normalizedInitial = normalizeUrl(initialUrl);
    const hasInitialUrl = Boolean(normalizedInitial) && normalizedInitial !== "about:blank";
    const [url, setUrl] = useState(normalizedInitial);
    const [inputUrl, setInputUrl] = useState(normalizedInitial);
    const [history, setHistory] = useState<string[]>(() =>
        hasInitialUrl ? [normalizedInitial] : [],
    );
    const [historyIndex, setHistoryIndex] = useState(() => (hasInitialUrl ? 0 : -1));
    const [reloadKey, setReloadKey] = useState(0);
    const webviewRef = useRef<WebviewElement | null>(null);

    const navigate = useCallback((raw: string) => {
        const normalized = normalizeUrl(raw);
        if (!normalized) return;
        setUrl(normalized);
        setInputUrl(normalized);
        setHistoryIndex((prevIndex) => {
            setHistory((prev) => {
                const next = prev.slice(0, prevIndex + 1);
                next.push(normalized);
                return next;
            });
            return prevIndex + 1;
        });
    }, []);

    const [canGoBack, setCanGoBack] = useState(false);

    useEffect(() => {
        if (isElectron) {
            setCanGoBack(Boolean(webviewRef.current?.canGoBack()));
        } else {
            setCanGoBack(historyIndex > 0);
        }
    }, [isElectron, historyIndex, url]);

    const goBack = useCallback(() => {
        if (isElectron) {
            webviewRef.current?.goBack();
            return;
        }
        if (historyIndex > 0) {
            const newIndex = historyIndex - 1;
            setHistoryIndex(newIndex);
            setUrl(history[newIndex]);
            setInputUrl(history[newIndex]);
        }
    }, [isElectron, historyIndex, history]);

    const reload = useCallback(() => {
        if (isElectron) {
            webviewRef.current?.reload();
            return;
        }
        setReloadKey((k) => k + 1);
    }, [isElectron]);

    const handleKeyDown = useCallback(
        (e: React.KeyboardEvent<HTMLInputElement>) => {
            if (e.key === "Enter") {
                navigate(e.currentTarget.value);
            }
        },
        [navigate],
    );

    const frameStyle: React.CSSProperties = {
        width: "100%",
        height: "100%",
        border: "none",
        flex: 1,
    };

    return (
        <div className="flex flex-1 flex-col">
            <div className="border-border flex items-center gap-1 border-b px-1.5 py-1.5">
                <Button variant="ghost" size="icon-xs" onClick={goBack} disabled={!canGoBack}>
                    <ArrowLeft className="h-4 w-4" />
                </Button>
                <Button variant="ghost" size="icon-xs" onClick={reload}>
                    <RotateCw className="h-4 w-4" />
                </Button>
                <Input
                    value={inputUrl}
                    onChange={(e) => setInputUrl(e.target.value)}
                    onKeyDown={handleKeyDown}
                    className="h-8 flex-1 text-sm"
                    placeholder="Enter URL..."
                />
            </div>

            {isElectron ? (
                <webview ref={webviewRef} src={url} style={frameStyle} />
            ) : (
                <iframe
                    key={reloadKey}
                    src={url}
                    style={frameStyle}
                    sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
                    title="Browser"
                />
            )}
        </div>
    );
}

export { BrowserPane };
