import { AntigravityOptions } from "@/components/shared/AntigravityOptions";
import { useBackendStore } from "@/stores/backend-store";
import { settingsSetter } from "@/components/shared/launch-defaults";
import type { AntigravityEffortLevel, AntigravityMode } from "@taskflow/shared";

interface AntigravitySectionProps {
    defaultModel: string;
    defaultEffort: AntigravityEffortLevel | "default";
    mode: AntigravityMode;
    sandbox: boolean;
    dangerouslySkipPermissions: boolean;
    onModelChange: (value: string) => void;
    onEffortChange: (value: AntigravityEffortLevel | "default") => void;
    onModeChange: (value: AntigravityMode) => void;
    onSandboxChange: (value: boolean) => void;
    onDangerouslySkipPermissionsChange: (value: boolean) => void;
}

function AntigravitySection({
    defaultModel,
    defaultEffort,
    mode,
    sandbox,
    dangerouslySkipPermissions,
    onModelChange,
    onEffortChange,
    onModeChange,
    onSandboxChange,
    onDangerouslySkipPermissionsChange,
}: AntigravitySectionProps) {
    // Settings are primary's, so its Antigravity CLI lists the models.
    const primaryId = useBackendStore((s) => s.primaryId);
    return (
        <AntigravityOptions
            mode="defaults"
            backendId={primaryId}
            modelValue={defaultModel}
            effortValue={defaultEffort}
            modeValue={mode}
            sandboxValue={sandbox}
            dangerouslySkipPermissionsValue={dangerouslySkipPermissions}
            onModelChange={onModelChange}
            onEffortChange={onEffortChange}
            onModeChange={settingsSetter(onModeChange)}
            onSandboxChange={settingsSetter(onSandboxChange)}
            onDangerouslySkipPermissionsChange={settingsSetter(onDangerouslySkipPermissionsChange)}
        />
    );
}

export { AntigravitySection };
