import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ChevronDownIcon } from "lucide-react";
import { sendRequest } from "@/hooks/useWebSocket";
import { MSG } from "@taskflow/shared";
import type { OpenCodeAgentInfo, OpenCodeAgentsResponse } from "@taskflow/shared";

interface OpenCodeAgentSelectProps {
    value: string;
    onChange: (agent: string) => void;
}

function OpenCodeAgentSelect({ value, onChange }: OpenCodeAgentSelectProps) {
    const [open, setOpen] = useState(false);
    const [agents, setAgents] = useState<OpenCodeAgentInfo[] | null>(null);
    const [search, setSearch] = useState("");
    const [fetchFailed, setFetchFailed] = useState(false);
    const [portalContainer, setPortalContainer] = useState<HTMLElement | null>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const searchRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        if (!open || agents !== null || fetchFailed) return;
        sendRequest<OpenCodeAgentsResponse>(MSG.OPENCODE_AGENTS, {})
            .then((res) => {
                setAgents(res.agents);
            })
            .catch(() => {
                setFetchFailed(true);
            });
    }, [open, agents, fetchFailed]);

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
        if (!agents) return [];
        if (!search) return agents;
        const lower = search.toLowerCase();
        return agents.filter(
            (a) => a.name.toLowerCase().includes(lower) || a.kind.toLowerCase().includes(lower),
        );
    }, [agents, search]);

    const handleSelect = useCallback(
        (agent: string) => {
            onChange(agent);
            setOpen(false);
        },
        [onChange],
    );

    const displayLabel = useMemo(() => {
        if (!value) return null;
        const match = agents?.find((a) => a.name === value);
        return match ? `${match.name} (${match.kind})` : value;
    }, [value, agents]);

    if (fetchFailed) {
        return (
            <Input
                value={value}
                placeholder="e.g. build"
                onChange={(e) => onChange(e.target.value)}
                className="h-8 text-[13px]"
            />
        );
    }

    return (
        <div ref={containerRef} className="min-w-0">
            <Popover open={open} onOpenChange={handleOpenChange}>
                <PopoverTrigger asChild>
                    <Button
                        variant="outline"
                        className="h-8 w-full min-w-0 justify-between overflow-hidden text-[13px] font-normal">
                        <span className="min-w-0 flex-1 truncate text-left">
                            {displayLabel || "Default agent"}
                        </span>
                        <ChevronDownIcon className="ml-2 size-4 shrink-0 opacity-50" />
                    </Button>
                </PopoverTrigger>
                <PopoverContent
                    container={portalContainer ?? undefined}
                    className="w-[--radix-popover-trigger-width] min-w-56 p-0"
                    align="start">
                    <div className="border-border border-b p-2">
                        <Input
                            ref={searchRef}
                            placeholder="Search agents..."
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            className="h-7 text-sm"
                        />
                    </div>
                    <div className="max-h-60 overflow-y-auto p-1">
                        {agents === null ? (
                            <div className="text-muted-foreground px-2 py-4 text-center text-sm">
                                Loading agents...
                            </div>
                        ) : agents.length === 0 ? (
                            <div className="text-muted-foreground px-2 py-4 text-center text-sm">
                                No agents available
                            </div>
                        ) : filtered.length === 0 ? (
                            <div className="text-muted-foreground px-2 py-4 text-center text-sm">
                                No agents found
                            </div>
                        ) : (
                            filtered.map((a) => (
                                <button
                                    key={a.name}
                                    type="button"
                                    className={`hover:bg-accent hover:text-accent-foreground flex w-full cursor-default items-center rounded-sm px-2 py-1.5 text-left text-sm outline-hidden ${
                                        a.name === value
                                            ? "bg-accent text-accent-foreground"
                                            : ""
                                    }`}
                                    onClick={() => handleSelect(a.name)}>
                                    <span className="truncate">
                                        {a.name}{" "}
                                        <span className="text-muted-foreground">({a.kind})</span>
                                    </span>
                                </button>
                            ))
                        )}
                    </div>
                </PopoverContent>
            </Popover>
        </div>
    );
}

export { OpenCodeAgentSelect };
