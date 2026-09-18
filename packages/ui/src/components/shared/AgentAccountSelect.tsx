import {
    DEFAULT_AGENT_ACCOUNT_ID,
    INHERIT_AGENT_ACCOUNT,
    type AgentAccount,
} from "@taskflow/shared";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { SettingRow } from "@/components/settings/sections/SettingRow";

interface AgentAccountSelectProps {
    label: string;
    hint: string;
    accounts: AgentAccount[];
    /** Account id, "default", or "inherit" (only meaningful with inheritLabel). */
    value: string;
    /** When set, the first option inherits from the next level with this label. */
    inheritLabel?: string;
    onChange: (value: string) => void;
}

function AgentAccountSelect({
    label,
    hint,
    accounts,
    value,
    inheritLabel,
    onChange,
}: AgentAccountSelectProps) {
    // A stored value may be an account name (from the CLI or YAML) rather than
    // an id -- map it to its id so the trigger (which renders by id via
    // SelectItem) can display it.
    const selected = accounts.find((account) => account.name === value)?.id ?? value;

    const known =
        selected === DEFAULT_AGENT_ACCOUNT_ID ||
        (inheritLabel !== undefined && selected === INHERIT_AGENT_ACCOUNT) ||
        accounts.some((account) => account.id === selected);

    return (
        <SettingRow label={label} hint={hint}>
            <Select value={selected} onValueChange={onChange}>
                <SelectTrigger size="sm" className="text-[13px]">
                    <SelectValue />
                </SelectTrigger>
                <SelectContent>
                    {inheritLabel !== undefined && (
                        <SelectItem value={INHERIT_AGENT_ACCOUNT}>{inheritLabel}</SelectItem>
                    )}
                    <SelectItem value={DEFAULT_AGENT_ACCOUNT_ID}>
                        Default (inherited environment)
                    </SelectItem>
                    {accounts.map((account) => (
                        <SelectItem key={account.id} value={account.id}>
                            {account.name}
                        </SelectItem>
                    ))}
                    {!known && (
                        <SelectItem value={selected}>{`Unknown account (${selected})`}</SelectItem>
                    )}
                </SelectContent>
            </Select>
        </SettingRow>
    );
}

export { AgentAccountSelect };
