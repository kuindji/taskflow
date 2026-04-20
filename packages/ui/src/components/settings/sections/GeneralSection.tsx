import { Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { TruncatedText } from "@/components/ui/truncated-text";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { SettingRow } from "./SettingRow";

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
    confirmBeforeExit: boolean;
    onChangeDataDir: () => void;
    onResetDataDir: () => void;
    onConfirmBeforeExitChange: (value: boolean) => void;
}

function GeneralSection({
    dataDirInfo,
    migrating,
    migrationError,
    confirmBeforeExit,
    onChangeDataDir,
    onResetDataDir,
    onConfirmBeforeExitChange,
}: GeneralSectionProps) {
    return (
        <div className="flex h-full flex-col gap-3 overflow-y-auto p-3">
            <div className="hover:bg-island-base flex flex-col gap-3 rounded-md px-3 py-3 transition-colors">
                <div className="flex items-center gap-1.5">
                    <div className="text-secondary-foreground text-[13px] font-medium">
                        Data Folder
                    </div>
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
                    <Button
                        variant="outline"
                        size="sm"
                        disabled={migrating}
                        onClick={onChangeDataDir}>
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

            <SettingRow
                label="Ask before exit"
                hint="Show a confirmation prompt when quitting Taskflow."
                className="px-3 py-2">
                <Switch
                    id="confirm-before-exit"
                    checked={confirmBeforeExit}
                    onCheckedChange={onConfirmBeforeExitChange}
                />
            </SettingRow>
        </div>
    );
}

export { GeneralSection };
