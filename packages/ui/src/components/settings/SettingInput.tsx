import { useState, type ComponentProps } from "react";
import { Input } from "@/components/ui/input";

type SettingInputProps = Omit<ComponentProps<typeof Input>, "value"> & {
    /** The saved value. */
    value: string | number;
};

/**
 * An input over a saved setting that saves on every keystroke. While it is
 * being typed into it shows what was typed: bound to the saved value alone,
 * React would put the old text back after each keystroke until the backend
 * answered, so text typed during the round trip would be lost. On blur it
 * shows the saved value again.
 */
function SettingInput({ value, onChange, onBlur, ...props }: SettingInputProps) {
    const [draft, setDraft] = useState<string | null>(null);
    return (
        <Input
            {...props}
            value={draft ?? value}
            onChange={(event) => {
                setDraft(event.target.value);
                onChange?.(event);
            }}
            onBlur={(event) => {
                setDraft(null);
                onBlur?.(event);
            }}
        />
    );
}

export { SettingInput };
