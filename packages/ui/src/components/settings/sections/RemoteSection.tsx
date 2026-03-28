import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import type { RemoteAgentSettings } from "@taskflow/shared";
import { SettingRow } from "./SettingRow";

interface RemoteAgentStatus {
    running: boolean;
    start: () => Promise<void>;
    stop: () => Promise<void>;
}

interface RemoteSectionProps {
    settings: RemoteAgentSettings;
    remoteAgent: RemoteAgentStatus;
    onUpdate: (partial: Partial<RemoteAgentSettings>) => void;
}

function RemoteSection({ settings, remoteAgent, onUpdate }: RemoteSectionProps) {
    return (
        <>
            <SettingRow label="Auto Start" hint="Start remote agent when Taskflow launches">
                <div className="flex items-center gap-2.5">
                    <Switch
                        id="remote-auto-start"
                        checked={settings.autoStart}
                        onCheckedChange={(autoStart: boolean) => onUpdate({ autoStart })}
                    />
                    <Label
                        htmlFor="remote-auto-start"
                        className="text-muted-foreground cursor-pointer text-[13px] font-normal normal-case">
                        {settings.autoStart ? "Enabled" : "Disabled"}
                    </Label>
                </div>
            </SettingRow>
            <SettingRow label="App Name" hint="Display name for this instance on remote apps">
                <Input
                    className="h-8 w-[180px] text-[13px]"
                    placeholder="Auto-generated"
                    value={settings.appName}
                    onChange={(e) => onUpdate({ appName: e.target.value })}
                />
            </SettingRow>
            <SettingRow label="Headless" hint="Run without showing a session tab">
                <div className="flex items-center gap-2.5">
                    <Switch
                        id="remote-headless"
                        checked={settings.headless}
                        onCheckedChange={(headless: boolean) => onUpdate({ headless })}
                    />
                    <Label
                        htmlFor="remote-headless"
                        className="text-muted-foreground cursor-pointer text-[13px] font-normal normal-case">
                        {settings.headless ? "Enabled" : "Disabled"}
                    </Label>
                </div>
            </SettingRow>
            <SettingRow
                label="Status"
                hint={remoteAgent.running ? "Remote agent is running" : "Remote agent is stopped"}>
                <div className="flex items-center gap-2.5">
                    {remoteAgent.running && (
                        <span className="inline-block h-2 w-2 rounded-full bg-green-500" />
                    )}
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={() =>
                            void (remoteAgent.running ? remoteAgent.stop() : remoteAgent.start())
                        }>
                        {remoteAgent.running ? "Stop" : "Start"}
                    </Button>
                </div>
            </SettingRow>
        </>
    );
}

export { RemoteSection };
