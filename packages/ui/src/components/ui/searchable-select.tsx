import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ChevronDownIcon } from "lucide-react";

interface SelectOption {
    value: string;
    label: string;
}

interface SearchableSelectProps {
    value: string;
    onChange: (value: string) => void;
    options: SelectOption[] | null;
    placeholder?: string;
    allowCustom?: boolean;
    className?: string;
}

function SearchableSelect({
    value,
    onChange,
    options,
    placeholder = "Select...",
    allowCustom = false,
    className,
}: SearchableSelectProps) {
    const [open, setOpen] = useState(false);
    const [search, setSearch] = useState("");
    const [portalContainer, setPortalContainer] = useState<HTMLElement | null>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const searchRef = useRef<HTMLInputElement>(null);

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
        if (!options) return [];
        if (!search) return options;
        const lower = search.toLowerCase();
        return options.filter(
            (opt) =>
                opt.label.toLowerCase().includes(lower) ||
                opt.value.toLowerCase().includes(lower),
        );
    }, [options, search]);

    const handleSelect = useCallback(
        (val: string) => {
            onChange(val);
            setOpen(false);
        },
        [onChange],
    );

    const handleKeyDown = useCallback(
        (e: React.KeyboardEvent) => {
            if (e.key === "Enter" && allowCustom && search) {
                onChange(search);
                setOpen(false);
            }
        },
        [allowCustom, search, onChange],
    );

    const displayLabel = useMemo(() => {
        if (!value) return null;
        const opt = options?.find((o) => o.value === value);
        return opt?.label ?? value;
    }, [value, options]);

    if (allowCustom && !options) {
        return (
            <Input
                value={value}
                onChange={(e) => onChange(e.target.value)}
                placeholder={placeholder}
                className={className}
            />
        );
    }

    return (
        <div ref={containerRef} className="min-w-0">
            <Popover open={open} onOpenChange={handleOpenChange}>
                <PopoverTrigger asChild>
                    <Button
                        variant="outline"
                        className={`h-8 w-full min-w-0 justify-between overflow-hidden text-sm font-normal ${className ?? ""}`}>
                        <span className="min-w-0 flex-1 truncate text-left">
                            {displayLabel || placeholder}
                        </span>
                        <ChevronDownIcon className="ml-2 size-4 shrink-0 opacity-50" />
                    </Button>
                </PopoverTrigger>
                <PopoverContent
                    container={portalContainer ?? undefined}
                    className="w-[--radix-popover-trigger-width] min-w-72 p-0"
                    align="start">
                    <div className="border-border border-b p-2">
                        <Input
                            ref={searchRef}
                            placeholder="Search..."
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            onKeyDown={handleKeyDown}
                            className="h-7 text-sm"
                        />
                    </div>
                    <div className="max-h-60 overflow-y-auto p-1">
                        {options === null ? (
                            <div className="text-muted-foreground px-2 py-4 text-center text-sm">
                                Loading...
                            </div>
                        ) : filtered.length === 0 ? (
                            <div className="text-muted-foreground px-2 py-4 text-center text-sm">
                                {allowCustom && search
                                    ? "No matches — press Enter to use custom value"
                                    : "No results found"}
                            </div>
                        ) : (
                            filtered.map((opt) => (
                                <button
                                    key={opt.value}
                                    type="button"
                                    className={`hover:bg-accent hover:text-accent-foreground flex w-full cursor-default items-center rounded-sm px-2 py-1.5 text-left text-sm outline-hidden ${
                                        opt.value === value
                                            ? "bg-accent text-accent-foreground"
                                            : ""
                                    }`}
                                    onClick={() => handleSelect(opt.value)}>
                                    <span className="truncate">{opt.label}</span>
                                </button>
                            ))
                        )}
                    </div>
                </PopoverContent>
            </Popover>
        </div>
    );
}

export { SearchableSelect };
export type { SelectOption, SearchableSelectProps };
