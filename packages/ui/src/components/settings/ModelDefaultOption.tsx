interface ModelDefaultOptionProps {
    /** Agent name shown in the row, e.g. "Codex". */
    agent: string;
    /** True when no model override is set. */
    selected: boolean;
    onSelect: () => void;
}

/** The model picker row that clears the override so the agent CLI picks its own model. */
function ModelDefaultOption({ agent, selected, onSelect }: ModelDefaultOptionProps) {
    return (
        <button
            type="button"
            className={`hover:bg-accent hover:text-accent-foreground flex w-full cursor-default flex-col items-start rounded-sm px-2 py-1.5 text-left text-sm outline-hidden ${
                selected ? "bg-accent text-accent-foreground" : ""
            }`}
            onClick={onSelect}>
            <span>{agent} default</span>
            <span className="text-muted-foreground text-[11px]">
                Follow the installed CLI default
            </span>
        </button>
    );
}

export { ModelDefaultOption };
