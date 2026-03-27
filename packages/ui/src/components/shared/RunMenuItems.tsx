import { Fragment, useMemo, type ComponentType, type ReactNode } from "react";
import { ALL_AGENT_TYPES, AGENT_DISPLAY_NAMES } from "@taskflow/shared";
import { SquareTerminal, Workflow, Zap } from "lucide-react";
import { ClaudeIcon } from "@/components/icons/ClaudeIcon";
import { AGENT_META } from "@/components/workspace/tab-constants";
import { isAgentAvailable } from "@/hooks/useAgentAvailability";
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
    Label: ComponentType<{ children: ReactNode }>;
}

interface RunMenuItemsProps {
    data: RunMenuData;
    callbacks: RunMenuCallbacks;
    components: MenuComponents;
}

function RunMenuItems({ data, callbacks, components }: RunMenuItemsProps) {
    const { Sub, SubTrigger, SubContent, Item, Separator, Label } = components;

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
                    <SubTrigger>
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
            {data.flows.length > 0 && !data.activeFlowRun && (
                <>
                    {(scriptNames.length > 0 || data.agentCommands.length > 0) && <Separator />}
                    <Sub>
                        <SubTrigger>
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
                        data.flows.length === 0 && <Separator />}
                    <Sub>
                        <SubTrigger>
                            <Zap className="mr-2 h-4 w-4" />
                            Actions
                        </SubTrigger>
                        <SubContent>
                            {data.standaloneActions.map((a) => (
                                <Item key={a.id} onSelect={() => callbacks.onRunAction(a)}>
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
            {data.showAgentOptions && (
                <>
                    {(scriptNames.length > 0 ||
                        data.flows.length > 0 ||
                        data.standaloneActions.length > 0 ||
                        data.agentCommands.length > 0) && <Separator />}
                    <Label>Run agent with task description</Label>
                    {ALL_AGENT_TYPES.map((agentType) => {
                        const meta = AGENT_META[agentType];
                        const available = isAgentAvailable(data.agents, agentType);
                        const Icon = meta.icon;
                        const label = AGENT_DISPLAY_NAMES[agentType];
                        return (
                            <Fragment key={agentType}>
                                <Item
                                    disabled={!available}
                                    onSelect={() => {
                                        if (available) callbacks.onRunTab?.(agentType);
                                    }}>
                                    <Icon className="mr-2 h-4 w-4" />
                                    {label}
                                    {!available ? " (not installed)" : ""}
                                </Item>
                                {available && callbacks.onRunTabWithOptions && (
                                    <Item
                                        onSelect={() => callbacks.onRunTabWithOptions?.(agentType)}>
                                        <Icon className="mr-2 h-4 w-4" />
                                        {label} with options...
                                    </Item>
                                )}
                            </Fragment>
                        );
                    })}
                </>
            )}
        </>
    );
}

export { RunMenuItems };
export type { MenuComponents };
