import { useEffect, useRef, useState } from "react";
import type { BrowserTab } from "@taskflow/shared";
import { ArrowLeft, ExternalLink, RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Toolbar } from "@/components/ui/toolbar";
import { overlayRects, subscribeOverlays } from "@/lib/overlay-registry";
import { normalizeUrl } from "@/utils/url";
import { openExternalUrl } from "./terminal/terminal-links";

export function HostedBrowserPane({ tab }: { tab: BrowserTab }) {
    const placeholder = useRef<HTMLDivElement>(null);
    const [inputUrl, setInputUrl] = useState(tab.url);
    const [canGoBack, setCanGoBack] = useState(false);
    const [snapshot, setSnapshot] = useState("");
    const bridge = window.taskflow?.browser;
    // Navigation changes tab.url; reading it through a ref keeps the view
    // from being hidden and shown again on every page load.
    const url = useRef(tab.url);
    url.current = tab.url;
    useEffect(() => setInputUrl(tab.url), [tab.url]);
    useEffect(
        () =>
            bridge?.onNavState((id, state) => {
                if (id === tab.id) setCanGoBack(state.canGoBack);
            }),
        [bridge, tab.id],
    );
    useEffect(() => {
        const el = placeholder.current;
        if (!el || !bridge) return;
        let disposed = false;
        let frame = 0;
        let frozen = false;
        let generation = 0;
        const update = () => {
            frame = 0;
            const rect = el.getBoundingClientRect();
            const intersects = overlayRects().some(
                (overlay) =>
                    overlay.left < rect.right &&
                    overlay.right > rect.left &&
                    overlay.top < rect.bottom &&
                    overlay.bottom > rect.top,
            );
            if (intersects) {
                if (frozen) return;
                frozen = true;
                const capture = ++generation;
                setSnapshot("");
                void bridge.freeze(tab.id).then(
                    (image) => {
                        if (!disposed && frozen && capture === generation) setSnapshot(image);
                    },
                    () => {
                        if (!disposed && frozen && capture === generation) setSnapshot("");
                    },
                );
            } else {
                frozen = false;
                ++generation;
                setSnapshot("");
                void bridge
                    .show(tab.id, url.current, {
                        x: rect.x,
                        y: rect.y,
                        width: rect.width,
                        height: rect.height,
                    })
                    .catch(() => {});
            }
        };
        const schedule = () => {
            if (!frame) frame = requestAnimationFrame(update);
        };
        const observer = new ResizeObserver(schedule);
        observer.observe(el);
        const unsubscribe = subscribeOverlays(schedule);
        window.addEventListener("resize", schedule);
        schedule();
        return () => {
            disposed = true;
            ++generation;
            cancelAnimationFrame(frame);
            observer.disconnect();
            unsubscribe();
            window.removeEventListener("resize", schedule);
            void bridge.hide(tab.id).catch(() => {});
        };
    }, [bridge, tab.id]);
    return (
        <div className="flex min-h-0 flex-1 flex-col">
            <Toolbar className="gap-1">
                <Button
                    variant="ghost"
                    size="icon-xs"
                    aria-label="Go back"
                    tooltip="Go back"
                    tooltipSide="bottom"
                    disabled={!canGoBack}
                    onClick={() => void bridge?.back(tab.id)}>
                    <ArrowLeft className="h-4 w-4" />
                </Button>
                <Button
                    variant="ghost"
                    size="icon-xs"
                    aria-label="Reload"
                    tooltip="Reload"
                    tooltipSide="bottom"
                    onClick={() => void bridge?.reload(tab.id)}>
                    <RotateCw className="h-4 w-4" />
                </Button>
                <Button
                    variant="ghost"
                    size="icon-xs"
                    aria-label="Open in external browser"
                    tooltip="Open in external browser"
                    tooltipSide="bottom"
                    disabled={!tab.url || tab.url === "about:blank"}
                    onClick={() => openExternalUrl(tab.url)}>
                    <ExternalLink className="h-4 w-4" />
                </Button>
                <Input
                    value={inputUrl}
                    onChange={(event) => setInputUrl(event.target.value)}
                    onKeyDown={(event) => {
                        if (event.key === "Enter") {
                            const url = normalizeUrl(event.currentTarget.value);
                            if (url) void bridge?.navigate(tab.id, url);
                        }
                    }}
                    className="h-7 flex-1 px-2.5 text-sm"
                    placeholder="Enter URL..."
                />
            </Toolbar>
            <div ref={placeholder} className="relative min-h-0 flex-1">
                {snapshot && (
                    <img
                        src={snapshot}
                        alt="Frozen browser page"
                        className="absolute inset-0 h-full w-full object-fill"
                    />
                )}
            </div>
        </div>
    );
}
