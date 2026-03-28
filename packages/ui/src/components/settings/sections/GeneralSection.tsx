import { Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { TruncatedText } from "@/components/ui/truncated-text";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";

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
        <div className="hover:bg-island-base flex flex-col gap-3 rounded-md px-3 py-3 transition-colors">
            <div className="flex items-center gap-1.5">
                <div className="text-secondary-foreground text-[13px] font-medium">Data Folder</div>
                <Tooltip>
                    <TooltipTrigger>
                        <Info className="text-muted-foreground h-3 w-3 shrink-0" />
                    </TooltipTrigger>
                    <TooltipContent side="top">
                        Location where projects, tasks, and session data are stored
                    </TooltipContent>
                </Tooltip>
            </div>
            <TruncatedText
                as="code"
                tooltip
                tooltipSide="bottom"
                className="bg-card border-border text-muted-foreground flex h-8 w-full max-w-110 min-w-0 items-center overflow-x-auto rounded-md border px-2.5 font-mono text-xs"
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
