import { useCallback, useEffect, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Toolbar } from "@/components/ui/toolbar";
import { ArrowLeft, ExternalLink, RotateCw } from "lucide-react";
import useIsElectron from "@/hooks/useIsElectron";
import { normalizeUrl } from "@/utils/url";

interface BrowserPaneProps {
    initialUrl: string;
}

type WebviewNavigationEvent = Event & { url?: string };

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
    const [webviewReady, setWebviewReady] = useState(false);
    const [canGoBack, setCanGoBack] = useState(false);

    useEffect(() => {
        const wv = webviewRef.current;
        if (!wv || !isElectron) return;

        const syncWebviewState = (nextUrl?: string) => {
            const resolvedUrl = nextUrl || wv.getURL?.() || wv.src;
            if (resolvedUrl) {
                setUrl(resolvedUrl);
                setInputUrl(resolvedUrl);
            }
            setCanGoBack(wv.canGoBack());
        };

        const onReady = () => {
            setWebviewReady(true);
            syncWebviewState();
        };
        const onNavigate = (event: WebviewNavigationEvent) => {
            const nextUrl = event.url;
            syncWebviewState(nextUrl);
        };

        wv.addEventListener("dom-ready", onReady);
        wv.addEventListener("did-navigate", onNavigate);
        wv.addEventListener("did-navigate-in-page", onNavigate);
        return () => {
            wv.removeEventListener("dom-ready", onReady);
            wv.removeEventListener("did-navigate", onNavigate);
            wv.removeEventListener("did-navigate-in-page", onNavigate);
        };
    }, [isElectron]);

    const navigate = useCallback(
        (raw: string) => {
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
            if (!isElectron) {
                setCanGoBack(true);
            }
        },
        [isElectron],
    );

    const goBack = useCallback(() => {
        if (isElectron) {
            if (webviewReady) webviewRef.current?.goBack();
            return;
        }
        if (historyIndex > 0) {
            const newIndex = historyIndex - 1;
            setHistoryIndex(newIndex);
            setUrl(history[newIndex]);
            setInputUrl(history[newIndex]);
            setCanGoBack(newIndex > 0);
        }
    }, [isElectron, webviewReady, historyIndex, history]);

    const reload = useCallback(() => {
        if (isElectron) {
            if (webviewReady) webviewRef.current?.reload();
            return;
        }
        setReloadKey((k) => k + 1);
    }, [isElectron, webviewReady]);

    const openExternal = useCallback(() => {
        const targetUrl =
            (isElectron && webviewReady ? webviewRef.current?.getURL?.() : undefined) || url;
        if (!targetUrl || targetUrl === "about:blank") return;

        if (window.taskflow) {
            void window.taskflow.openExternalUrl(targetUrl);
            return;
        }

        window.open(targetUrl, "_blank", "noopener,noreferrer");
    }, [isElectron, webviewReady, url]);

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
            <Toolbar className="gap-1">
                <Button
                    variant="ghost"
                    size="icon-xs"
                    onClick={goBack}
                    disabled={!canGoBack}
                    aria-label="Go back"
                    tooltip="Go back"
                    tooltipSide="bottom"
                >
                    <ArrowLeft className="h-4 w-4" />
                </Button>
                <Button
                    variant="ghost"
                    size="icon-xs"
                    onClick={reload}
                    aria-label="Reload"
                    tooltip="Reload"
                    tooltipSide="bottom"
                >
                    <RotateCw className="h-4 w-4" />
                </Button>
                <Button
                    variant="ghost"
                    size="icon-xs"
                    onClick={openExternal}
                    disabled={!url || url === "about:blank"}
                    aria-label="Open in external browser"
                    tooltip="Open in external browser"
                    tooltipSide="bottom"
                >
                    <ExternalLink className="h-4 w-4" />
                </Button>
                <Input
                    value={inputUrl}
                    onChange={(e) => setInputUrl(e.target.value)}
                    onKeyDown={handleKeyDown}
                    className="h-7 flex-1 px-2.5 text-sm"
                    placeholder="Enter URL..."
                />
            </Toolbar>

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
