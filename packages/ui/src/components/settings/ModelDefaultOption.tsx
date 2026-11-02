interface ModelDefaultOptionProps {
    /** Agent name shown in the row, e.g. "Codex". */
    agent: string;
    /** True when no model override is set. */
    selected: boolean;
    onSelect: () => void;
    /** Session pickers: the Settings model an unset model launches with. */
    inheritedLabel?: string;
}

/**
 * The model picker row that clears the override: the agent CLI picks its own
 * model, or in a session picker the machine's Settings model applies.
 */
function ModelDefaultOption({
    agent,
    selected,
    onSelect,
    inheritedLabel,
}: ModelDefaultOptionProps) {
    return (
        <button
            type="button"
            className={`hover:bg-accent hover:text-accent-foreground flex w-full cursor-default flex-col items-start rounded-sm px-2 py-1.5 text-left text-sm outline-hidden ${
                selected ? "bg-accent text-accent-foreground" : ""
            }`}
            onClick={onSelect}>
            <span>{inheritedLabel ?? `${agent} default`}</span>
            <span className="text-muted-foreground text-[11px]">
                {inheritedLabel ? "Follow the Settings model" : "Follow the installed CLI default"}
            </span>
        </button>
    );
}

export { ModelDefaultOption };
