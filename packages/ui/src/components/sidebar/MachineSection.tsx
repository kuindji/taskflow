import type { ReactNode } from "react";
import type { Project } from "@taskflow/shared";
import { ChevronRight, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent } from "@/components/ui/collapsible";
import type { Scoped } from "@/lib/backend-scope";
import { cn } from "@/lib/utils";
import { useBackendStore } from "@/stores/backend-store";
import type { MachineState } from "@/stores/backend-store";

interface MachineSectionProps {
    machine: MachineState;
    projects: Scoped<Project>[];
    open: boolean;
    onOpenChange: (open: boolean) => void;
    /** Draws the project list, so every machine's rows look like local's. */
    renderProjects: (projects: Scoped<Project>[]) => ReactNode;
}

const DOT_CLASS: Record<Exclude<MachineState["state"], "attaching">, string> = {
    attached: "bg-success",
    offline: "bg-destructive",
    incompatible: "bg-warning",
};

/**
 * One machine's projects. Local renders exactly as the sidebar always has, with
 * no header; a remote machine gets a header saying whether it is reachable, and
 * only an attached one lists projects — there is no local copy to show otherwise.
 */
function MachineSection({
    machine,
    projects,
    open,
    onOpenChange,
    renderProjects,
}: MachineSectionProps) {
    const retry = useBackendStore((s) => s.retry);
    const sharesHost = useBackendStore((s) =>
        s.machines.some((m) => m.id !== machine.id && m.host === machine.host),
    );

    if (machine.isLocal) return <>{renderProjects(projects)}</>;

    const attached = machine.state === "attached";

    return (
        <Collapsible open={attached && open} onOpenChange={onOpenChange} className="mt-3 min-w-0">
            <div className="flex min-w-0 items-center gap-1.5 px-1 py-1 [-webkit-app-region:no-drag]">
                {attached && (
                    <button
                        type="button"
                        onClick={() => onOpenChange(!open)}
                        aria-label={open ? "Collapse machine" : "Expand machine"}
                        className="text-muted-foreground flex shrink-0 items-center">
                        <ChevronRight
                            className={cn("h-3.5 w-3.5 duration-200", open && "rotate-90")}
                        />
                    </button>
                )}
                {machine.state === "attaching" ? (
                    <Loader2 className="text-muted-foreground h-3 w-3 shrink-0 animate-spin" />
                ) : (
                    <span
                        className={cn(
                            "inline-block h-2 w-2 shrink-0 rounded-full",
                            DOT_CLASS[machine.state],
                        )}
                    />
                )}
                <span
                    className="text-muted-foreground min-w-0 truncate text-xs font-semibold tracking-wide uppercase"
                    title={machine.host}>
                    {machine.displayName}
                </span>
                {sharesHost && (
                    <Badge
                        variant="outline"
                        className="border-border/60 bg-muted/50 shrink-0 px-1.5 py-0 text-[10px] font-medium">
                        {machine.instanceId}
                    </Badge>
                )}
                {machine.state === "attaching" && (
                    <span className="text-muted-foreground shrink-0 text-xs">connecting</span>
                )}
            </div>
            {machine.state === "offline" && (
                <div className="flex min-w-0 items-center gap-2 pr-1 pb-1 pl-4.5">
                    <span
                        className="text-muted-foreground min-w-0 flex-1 truncate text-xs"
                        title={machine.failure?.message}>
                        {machine.failure?.message ?? "Not connected"}
                    </span>
                    <Button
                        variant="ghost"
                        size="xs"
                        onClick={() => retry(machine.id)}
                        className="shrink-0 [-webkit-app-region:no-drag]">
                        Retry
                    </Button>
                </div>
            )}
            {machine.state === "incompatible" && (
                <div className="text-warning pr-1 pb-1 pl-4.5 text-xs">
                    needs update — this machine is running a different protocol version
                </div>
            )}
            {attached && <CollapsibleContent>{renderProjects(projects)}</CollapsibleContent>}
        </Collapsible>
    );
}

export { MachineSection };
