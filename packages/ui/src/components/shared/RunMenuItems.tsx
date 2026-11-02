import { useMemo, type ComponentType, type ReactNode } from "react";
import { SquareTerminal, Workflow, Zap } from "lucide-react";
import { ClaudeIcon } from "@/components/icons/ClaudeIcon";
import { isAgentAvailable } from "@/hooks/useAgentAvailability";
import { canRunAction, offersFlows } from "@/lib/run-menu";
import type { RunMenuData, RunMenuCallbacks } from "@/lib/run-menu";

interface MenuComponents {
    Sub: ComponentType<{ children: ReactNode }>;
    SubTrigger: ComponentType<{
        children: ReactNode;
        disabled?: boolean;
        className?: string;
    }>;
    SubContent: ComponentType<{ children: ReactNode; className?: string }>;
    Item: ComponentType<{
        children: ReactNode;
        disabled?: boolean;
        onClick?: () => void;
        onSelect?: () => void;
        className?: string;
    }>;
    Separator: ComponentType<object>;
}

interface RunMenuItemsProps {
    data: RunMenuData;
    callbacks: RunMenuCallbacks;
    components: MenuComponents;
}

function RunMenuItems({ data, callbacks, components }: RunMenuItemsProps) {
    const { Sub, SubTrigger, SubContent, Item, Separator } = components;

    const scriptNames = useMemo(() => Object.keys(data.scripts), [data.scripts]);
    const hasClaudeAgent = isAgentAvailable(data.agents, "claude");

    return (
        <>
            {scriptNames.length > 0 && (
                <Sub>
                    <SubTrigger>
                        <SquareTerminal className="mr-2 h-4 w-4" />
                        package.json
                    </SubTrigger>
                    <SubContent>
                        {scriptNames.map((name) => (
                            <Item key={name} onSelect={() => callbacks.onRunScript(name)}>
                                <SquareTerminal className="mr-2 h-4 w-4" />
                                {name}
                                <span className="text-muted-foreground ml-auto text-xs">
                                    {data.defaultRuntime}
                                </span>
                            </Item>
                        ))}
                    </SubContent>
                </Sub>
            )}
            {data.agentCommands.length > 0 && hasClaudeAgent && (
                <Sub>
                    <SubTrigger disabled={!data.online}>
                        <ClaudeIcon className="mr-2 h-4 w-4" />
                        .claude
                    </SubTrigger>
                    <SubContent>
                        {data.agentCommands.map((cmd) => (
                            <Item
                                key={`${cmd.source}:${cmd.name}`}
                                onSelect={() => callbacks.onRunAgentCommand(cmd)}>
                                <ClaudeIcon className="mr-2 h-4 w-4" />
                                {cmd.name}
                                <span className="text-muted-foreground ml-auto text-xs">
                                    {cmd.source}
                                </span>
                            </Item>
                        ))}
                    </SubContent>
                </Sub>
            )}
            {offersFlows(data) && (
                <>
                    {(scriptNames.length > 0 || data.agentCommands.length > 0) && <Separator />}
                    <Sub>
                        <SubTrigger disabled={!data.online}>
                            <Workflow className="mr-2 h-4 w-4" />
                            Flows
                        </SubTrigger>
                        <SubContent>
                            {data.flows.map((f) => (
                                <Item key={f.id} onSelect={() => callbacks.onStartFlow(f.id)}>
                                    {f.name}
                                </Item>
                            ))}
                        </SubContent>
                    </Sub>
                </>
            )}
            {data.standaloneActions.length > 0 && (
                <>
                    {(scriptNames.length > 0 || data.agentCommands.length > 0) &&
                        !offersFlows(data) && <Separator />}
                    <Sub>
                        <SubTrigger
                            disabled={
                                !data.standaloneActions.some((a) => canRunAction(a, data.online))
                            }>
                            <Zap className="mr-2 h-4 w-4" />
                            Actions
                        </SubTrigger>
                        <SubContent>
                            {data.standaloneActions.map((a) => (
                                <Item
                                    key={a.id}
                                    disabled={!canRunAction(a, data.online)}
                                    onSelect={() => callbacks.onRunAction(a)}>
                                    {a.name}
                                    <span className="text-muted-foreground ml-auto text-xs">
                                        {a.sessionType}
                                    </span>
                                </Item>
                            ))}
                        </SubContent>
                    </Sub>
                </>
            )}
        </>
    );
}

export { RunMenuItems };
export type { MenuComponents };
