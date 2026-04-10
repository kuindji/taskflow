import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ChevronDownIcon } from "lucide-react";
import { sendRequest } from "@/hooks/useWebSocket";
import { MSG } from "@taskflow/shared";
import type { PiModelInfo, PiModelsResponse } from "@taskflow/shared";

interface PiModelSelectProps {
    value: string;
    onChange: (model: string) => void;
}

function modelKey(m: PiModelInfo): string {
    return `${m.provider}/${m.id}`;
}

function PiModelSelect({ value, onChange }: PiModelSelectProps) {
    const [open, setOpen] = useState(false);
    const [models, setModels] = useState<PiModelInfo[] | null>(null);
    const [search, setSearch] = useState("");
    const [fetchFailed, setFetchFailed] = useState(false);
    const [portalContainer, setPortalContainer] = useState<HTMLElement | null>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const searchRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        if (!open || models !== null || fetchFailed) return;
        sendRequest<PiModelsResponse>(MSG.PI_MODELS, {})
            .then((res) => {
                setModels(res.models);
            })
            .catch(() => {
                setFetchFailed(true);
            });
    }, [open, models, fetchFailed]);

    useEffect(() => {
        setPortalContainer(
            containerRef.current?.closest<HTMLElement>("[data-slot='dialog-content']") ?? null,
        );
    }, []);

    const handleOpenChange = useCallback((nextOpen: boolean) => {
        if (nextOpen) {
            setSearch("");
            requestAnimationFrame(() => searchRef.current?.focus());
        }
        setOpen(nextOpen);
    }, []);

    const filtered = useMemo(() => {
        if (!models) return [];
        if (!search) return models;
        const lower = search.toLowerCase();
        return models.filter(
            (m) =>
                modelKey(m).toLowerCase().includes(lower) ||
                m.provider.toLowerCase().includes(lower),
        );
    }, [models, search]);

    const handleSelect = useCallback(
        (key: string) => {
            onChange(key);
            setOpen(false);
        },
        [onChange],
    );

    const handleKeyDown = useCallback(
        (e: React.KeyboardEvent) => {
            if (e.key === "Enter" && search) {
                onChange(search);
                setOpen(false);
            }
        },
        [search, onChange],
    );

    const displayLabel = useMemo(() => {
        if (!value) return null;
        const match = models?.find((m) => modelKey(m) === value);
        return match ? modelKey(match) : value;
    }, [value, models]);

    if (fetchFailed) {
        return (
            <Input
                value={value}
                placeholder="e.g. anthropic/claude-sonnet-4.5"
                onChange={(e) => onChange(e.target.value)}
                size="sm"
                className="text-[13px]"
            />
        );
    }

    return (
        <div ref={containerRef} className="min-w-0">
            <Popover open={open} onOpenChange={handleOpenChange}>
                <PopoverTrigger asChild>
                    <Button
                        variant="outline"
                        size="sm"
                        className="w-full min-w-0 justify-between overflow-hidden text-[13px] font-normal">
                        <span className="min-w-0 flex-1 truncate text-left">
                            {displayLabel || "Select model..."}
                        </span>
                        <ChevronDownIcon className="ml-2 size-4 shrink-0 opacity-50" />
                    </Button>
                </PopoverTrigger>
                <PopoverContent
                    container={portalContainer ?? undefined}
                    className="w-[--radix-popover-trigger-width] min-w-80 p-0"
                    align="start">
                    <div className="border-border border-b p-2">
                        <Input
                            ref={searchRef}
                            placeholder="Search models... (Enter for custom)"
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            onKeyDown={handleKeyDown}
                            className="h-7 text-sm"
                        />
                    </div>
                    <div className="max-h-60 overflow-y-auto p-1">
                        {models === null ? (
                            <div className="text-muted-foreground px-2 py-4 text-center text-sm">
                                Loading models...
                            </div>
                        ) : models.length === 0 ? (
                            <div className="text-muted-foreground px-2 py-4 text-center text-sm">
                                No models available
                            </div>
                        ) : filtered.length === 0 ? (
                            <div className="text-muted-foreground px-2 py-4 text-center text-sm">
                                No matches — press Enter to use custom value
                            </div>
                        ) : (
                            filtered.map((m) => {
                                const key = modelKey(m);
                                const badges: string[] = [`${m.contextWindow} ctx`];
                                if (m.supportsThinking) badges.push("thinking");
                                if (m.supportsImages) badges.push("images");
                                return (
                                    <button
                                        key={key}
                                        type="button"
                                        className={`hover:bg-accent hover:text-accent-foreground flex w-full cursor-default flex-col items-start gap-0.5 rounded-sm px-2 py-1.5 text-left text-sm outline-hidden ${
                                            key === value ? "bg-accent text-accent-foreground" : ""
                                        }`}
                                        onClick={() => handleSelect(key)}>
                                        <span className="truncate">{key}</span>
                                        <span className="text-muted-foreground truncate text-[11px]">
                                            {badges.join(" · ")}
                                        </span>
                                    </button>
                                );
                            })
                        )}
                    </div>
                </PopoverContent>
            </Popover>
        </div>
    );
}

export { PiModelSelect };
