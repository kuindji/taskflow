import { Button } from "@/components/ui/button";
import { TruncatedText } from "@/components/ui/truncated-text";

interface DataDirInfo {
    dataDir: string;
    baseDir: string;
    isDefault: boolean;
    conflict?: boolean;
}

interface GeneralSectionProps {
    dataDirInfo: DataDirInfo | null;
    migrating: boolean;
    migrationError: string | null;
    onChangeDataDir: () => void;
    onResetDataDir: () => void;
}

function GeneralSection({
    dataDirInfo,
    migrating,
    migrationError,
    onChangeDataDir,
    onResetDataDir,
}: GeneralSectionProps) {
    return (
        <div className="hover:bg-island-base mx-1 flex flex-col gap-2 rounded-md px-3 py-3 transition-colors">
            <div>
                <div className="text-secondary-foreground text-[13px] font-medium">Data Folder</div>
                <div className="text-muted-foreground text-[11px]">
                    Location where projects, tasks, and session data are stored
                </div>
            </div>
            <TruncatedText
                as="code"
                tooltip
                tooltipSide="bottom"
                className="bg-card border-border text-muted-foreground flex h-8 w-full max-w-90 min-w-0 items-center overflow-x-auto rounded-md border px-2.5 font-mono text-xs"
                tooltipContent={dataDirInfo?.dataDir ?? "Loading..."}>
                {dataDirInfo?.dataDir ?? "Loading..."}
            </TruncatedText>
            <div className="flex flex-wrap gap-1.5">
                <Button variant="outline" size="sm" disabled={migrating} onClick={onChangeDataDir}>
                    {migrating ? "Moving..." : "Change..."}
                </Button>
                {dataDirInfo && !dataDirInfo.isDefault && (
                    <Button
                        variant="outline"
                        size="sm"
                        disabled={migrating}
                        onClick={onResetDataDir}>
                        Reset
                    </Button>
                )}
            </div>
            {migrationError && <p className="text-destructive text-xs">{migrationError}</p>}
            {dataDirInfo && !dataDirInfo.isDefault && (
                <p className="text-muted-foreground text-xxs">
                    Using custom location. Config files remain in ~/.config/taskflow.
                </p>
            )}
        </div>
    );
}

export { GeneralSection };
