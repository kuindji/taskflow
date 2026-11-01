import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronDownIcon } from "lucide-react";
import { INHERIT_AGENT_ACCOUNT } from "@taskflow/shared";
import type { CodexModelInfo } from "@taskflow/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SettingInput } from "@/components/settings/SettingInput";
import { ModelDefaultOption } from "@/components/settings/ModelDefaultOption";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { loadCodexDiscovery } from "@/lib/agent-discovery";

interface CodexModelSelectProps {
    /** The machine whose Codex CLI lists the models; null before one is known. */
    backendId: string | null;
    account?: string;
    projectId?: string;
    discoveryKey?: string;
    loadDiscovery?: typeof loadCodexDiscovery;
    value: string;
    onChange: (model: string) => void;
    onModelsChange: (models: CodexModelInfo[]) => void;
}

function CodexModelSelect(props: CodexModelSelectProps) {
    return (
        <CodexModelSelectContext
            key={JSON.stringify([
                props.backendId,
                props.account,
                props.projectId,
                props.discoveryKey,
            ])}
            {...props}
        />
    );
}

function CodexModelSelectContext({
    backendId,
    account,
    projectId,
    discoveryKey,
    loadDiscovery = loadCodexDiscovery,
    value,
    onChange,
    onModelsChange,
}: CodexModelSelectProps) {
    const [open, setOpen] = useState(false);
    const [models, setModels] = useState<CodexModelInfo[] | null>(null);
    const [search, setSearch] = useState("");
    const [fetchFailed, setFetchFailed] = useState(false);
    const [portalContainer, setPortalContainer] = useState<HTMLElement | null>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const searchRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        let cancelled = false;
        setModels(null);
        onModelsChange([]);
        setFetchFailed(!backendId);
        if (!backendId) return;
        loadDiscovery(backendId, {
            ...(account && account !== INHERIT_AGENT_ACCOUNT ? { account } : {}),
            ...(projectId ? { projectId } : {}),
        })
            .then((response) => {
                if (cancelled) return;
                setModels(response.models);
                onModelsChange(response.models);
            })
            .catch(() => {
                if (!cancelled) setFetchFailed(true);
            });
        return () => {
            cancelled = true;
        };
    }, [backendId, account, projectId, discoveryKey, loadDiscovery, onModelsChange]);

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
            <SettingInput
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
                                    <ModelDefaultOption
                                        agent="Codex"
                                        selected={!value}
                                        onSelect={() => handleSelect("")}
                                    />
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
