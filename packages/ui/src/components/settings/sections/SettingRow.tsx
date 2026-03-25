interface SettingRowProps {
    label: string;
    hint: string;
    children: React.ReactNode;
}

function SettingRow({ label, hint, children }: SettingRowProps) {
    return (
        <div className="hover:bg-island-base mx-1 flex items-start justify-between rounded-md px-5 py-3 transition-colors">
            <div className="min-w-0 flex-1 pr-6">
                <div className="text-secondary-foreground text-[13px] font-medium">{label}</div>
                <div className="text-muted-foreground text-[11px] leading-snug">{hint}</div>
            </div>
            <div className="shrink-0">{children}</div>
        </div>
    );
}

export { SettingRow };
export type { SettingRowProps };
