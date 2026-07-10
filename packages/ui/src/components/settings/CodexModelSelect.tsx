import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronDownIcon } from "lucide-react";
import { MSG } from "@taskflow/shared";
import type { CodexModelInfo, CodexModelsResponse } from "@taskflow/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { sendRequest } from "@/hooks/useWebSocket";

interface CodexModelSelectProps {
    value: string;
    onChange: (model: string) => void;
    onModelsChange: (models: CodexModelInfo[]) => void;
}

let cachedModels: CodexModelInfo[] | null = null;
let pendingModels: Promise<CodexModelInfo[]> | null = null;

function loadCodexModels(): Promise<CodexModelInfo[]> {
    if (cachedModels) return Promise.resolve(cachedModels);
    if (pendingModels) return pendingModels;

    pendingModels = sendRequest<CodexModelsResponse>(MSG.CODEX_MODELS, {})
        .then((response) => {
            cachedModels = response.models;
            return response.models;
        })
        .finally(() => {
            pendingModels = null;
        });
    return pendingModels;
}

function CodexModelSelect({ value, onChange, onModelsChange }: CodexModelSelectProps) {
    const [open, setOpen] = useState(false);
    const [models, setModels] = useState<CodexModelInfo[] | null>(cachedModels);
    const [search, setSearch] = useState("");
    const [fetchFailed, setFetchFailed] = useState(false);
    const [portalContainer, setPortalContainer] = useState<HTMLElement | null>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const searchRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        let cancelled = false;
        loadCodexModels()
            .then((nextModels) => {
                if (cancelled) return;
                setModels(nextModels);
                onModelsChange(nextModels);
            })
            .catch(() => {
                if (!cancelled) setFetchFailed(true);
            });
        return () => {
            cancelled = true;
        };
    }, [onModelsChange]);

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
            (model) =>
                model.id.toLowerCase().includes(lower) ||
                model.displayName.toLowerCase().includes(lower) ||
                model.description.toLowerCase().includes(lower),
        );
    }, [models, search]);

    const handleSelect = useCallback(
        (model: string) => {
            onChange(model);
            setOpen(false);
        },
        [onChange],
    );

    const handleKeyDown = useCallback(
        (event: React.KeyboardEvent) => {
            if (event.key === "Enter" && search.trim()) {
                onChange(search.trim());
                setOpen(false);
            }
        },
        [onChange, search],
    );

    const displayLabel = useMemo(() => {
        if (!value) {
            const defaultModel = models?.find((model) => model.isDefault);
            return defaultModel ? `Codex default (${defaultModel.displayName})` : "Codex default";
        }
        return (
            models?.find((model) => model.model === value || model.id === value)?.displayName ??
            value
        );
    }, [models, value]);

    if (fetchFailed || (models !== null && models.length === 0)) {
        return (
            <Input
                value={value}
                placeholder="Codex default"
                onChange={(event) => onChange(event.target.value)}
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
                        <span className="min-w-0 flex-1 truncate text-left">{displayLabel}</span>
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
                            onChange={(event) => setSearch(event.target.value)}
                            onKeyDown={handleKeyDown}
                            className="h-7 text-sm"
                        />
                    </div>
                    <div className="max-h-72 overflow-y-auto p-1">
                        {models === null ? (
                            <div className="text-muted-foreground px-2 py-4 text-center text-sm">
                                Loading models...
                            </div>
                        ) : filtered.length === 0 ? (
                            <div className="text-muted-foreground px-2 py-4 text-center text-sm">
                                No matches — press Enter to use a custom value
                            </div>
                        ) : (
                            <>
                                {!search && (
                                    <button
                                        type="button"
                                        className={`hover:bg-accent hover:text-accent-foreground flex w-full cursor-default flex-col items-start rounded-sm px-2 py-1.5 text-left text-sm outline-hidden ${
                                            !value ? "bg-accent text-accent-foreground" : ""
                                        }`}
                                        onClick={() => handleSelect("")}>
                                        <span>Codex default</span>
                                        <span className="text-muted-foreground text-[11px]">
                                            Follow the installed CLI default
                                        </span>
                                    </button>
                                )}
                                {filtered.map((model) => (
                                    <button
                                        key={model.id}
                                        type="button"
                                        className={`hover:bg-accent hover:text-accent-foreground flex w-full cursor-default flex-col items-start rounded-sm px-2 py-1.5 text-left text-sm outline-hidden ${
                                            model.model === value || model.id === value
                                                ? "bg-accent text-accent-foreground"
                                                : ""
                                        }`}
                                        onClick={() => handleSelect(model.model)}>
                                        <span className="truncate">{model.displayName}</span>
                                        <span className="text-muted-foreground w-full truncate text-[11px]">
                                            {model.id} · {model.description}
                                        </span>
                                    </button>
                                ))}
                            </>
                        )}
                    </div>
                </PopoverContent>
            </Popover>
        </div>
    );
}

export { CodexModelSelect };
