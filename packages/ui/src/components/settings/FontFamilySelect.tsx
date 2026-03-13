import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ChevronDownIcon } from "lucide-react";

interface FontFamilySelectProps {
    value: string;
    onChange: (family: string) => void;
}

function FontFamilySelect({ value, onChange }: FontFamilySelectProps) {
    const [open, setOpen] = useState(false);
    const [fonts, setFonts] = useState<string[] | null>(null);
    const [search, setSearch] = useState("");
    const [apiAvailable, setApiAvailable] = useState(true);
    const [portalContainer, setPortalContainer] = useState<HTMLElement | null>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const searchRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        if (!open || fonts !== null) return;
        if (typeof window.queryLocalFonts !== "function") {
            setApiAvailable(false);
            return;
        }
        window
            .queryLocalFonts()
            .then((fontData) => {
                const families = [...new Set(fontData.map((f) => f.family))].sort((a, b) =>
                    a.localeCompare(b),
                );
                setFonts(families);
            })
            .catch(() => {
                setApiAvailable(false);
            });
    }, [open, fonts]);

    useEffect(() => {
        setPortalContainer(
            containerRef.current?.closest<HTMLElement>("[data-slot='dialog-content']") ?? null,
        );
    }, []);

    useEffect(() => {
        if (open) {
            setSearch("");
            // Focus the search input after popover opens
            requestAnimationFrame(() => searchRef.current?.focus());
        }
    }, [open]);

    const filtered = useMemo(() => {
        if (!fonts) return [];
        if (!search) return fonts;
        const lower = search.toLowerCase();
        return fonts.filter((f) => f.toLowerCase().includes(lower));
    }, [fonts, search]);

    const handleSelect = useCallback(
        (family: string) => {
            onChange(family);
            setOpen(false);
        },
        [onChange],
    );

    // Fallback: plain text input when queryLocalFonts is not available
    if (!apiAvailable) {
        return (
            <Input
                value={value}
                onChange={(e) => onChange(e.target.value)}
                className="h-8 text-sm"
            />
        );
    }

    return (
        <div ref={containerRef} className="min-w-0">
            <Popover open={open} onOpenChange={setOpen}>
                <PopoverTrigger asChild>
                    <Button
                        variant="outline"
                        className="h-8 w-full min-w-0 justify-between overflow-hidden text-sm font-normal"
                    >
                        <span className="min-w-0 flex-1 truncate text-left">
                            {value || "Select font..."}
                        </span>
                        <ChevronDownIcon className="ml-2 size-4 shrink-0 opacity-50" />
                    </Button>
                </PopoverTrigger>
                <PopoverContent
                    container={portalContainer ?? undefined}
                    className="w-[--radix-popover-trigger-width] min-w-72 p-0"
                    align="start"
                >
                    <div className="border-border border-b p-2">
                        <Input
                            ref={searchRef}
                            placeholder="Search fonts..."
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            className="h-7 text-sm"
                        />
                    </div>
                    <div className="max-h-60 overflow-y-auto p-1">
                        {fonts === null ? (
                            <div className="text-muted-foreground px-2 py-4 text-center text-sm">
                                Loading fonts...
                            </div>
                        ) : filtered.length === 0 ? (
                            <div className="text-muted-foreground px-2 py-4 text-center text-sm">
                                No fonts found
                            </div>
                        ) : (
                            filtered.map((family) => (
                                <button
                                    key={family}
                                    type="button"
                                    className={`hover:bg-accent hover:text-accent-foreground flex w-full cursor-default items-center rounded-sm px-2 py-1.5 text-left text-sm outline-hidden ${
                                        family === value ? "bg-accent text-accent-foreground" : ""
                                    }`}
                                    onClick={() => handleSelect(family)}
                                >
                                    <span className="truncate">{family}</span>
                                </button>
                            ))
                        )}
                    </div>
                </PopoverContent>
            </Popover>
        </div>
    );
}

export { FontFamilySelect };
