import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useUIStore } from "@/stores/ui-store";

const CAPABILITY_SECTIONS = [
    {
        title: "Task and workspace help",
        items: [
            "Inspect the current task, project, flow inputs, and workspace context before taking action.",
            "Create tasks, refine titles and descriptions, update notes, pin or archive work, and manage task-level worktree settings.",
            "Record progress in the task log so changes and findings stay attached to the task.",
        ],
    },
    {
        title: "Project and session management",
        items: [
            "List or organize projects, rename them, change visibility, and fork a project onto another branch when that is the right workflow.",
            "Rename, inspect, or close sessions, and open internal browser tabs when a task needs docs or another web page in the app.",
            "Start another agent session when the user explicitly asks for it.",
        ],
    },
    {
        title: "Automation and orchestration",
        items: [
            "Create and run reusable actions, then combine them into flows that can be started, paused, resumed, skipped, or redirected to another step.",
            "While inside a flow action, read flow inputs, inspect artifacts, save outputs, and mark the current action complete.",
            "Create schedules that run later or on a repeating cadence, update them, enable or disable them, and trigger them immediately when needed.",
        ],
    },
    {
        title: "Environment and feedback",
        items: [
            "Inspect local editors, shells, runtimes, and app settings to understand what tools are available in this environment.",
            "Send app notifications when a build, review, or long-running operation finishes.",
        ],
    },
    {
        title: "How to phrase requests",
        items: [
            "Describe the outcome you want in plain language, such as creating a task, updating task metadata, starting a flow, or saving a flow artifact.",
            "Availability depends on context: some operations only make sense inside a task, project, or flow action.",
            "Destructive requests like deleting tasks, projects, actions, flows, sessions, or worktrees should be explicit.",
        ],
    },
] as const;

function AgentOperationsHelpDialog() {
    const open = useUIStore((s) => s.agentOperationsHelpOpen);
    const setOpen = useUIStore((s) => s.setAgentOperationsHelpOpen);

    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <DialogContent className="sm:max-w-2xl">
                <DialogHeader>
                    <DialogTitle>What Agents Can Do</DialogTitle>
                    <DialogDescription>
                        This explains the kinds of Taskflow operations you can ask an agent to perform.
                        It describes capabilities, not terminal commands.
                    </DialogDescription>
                </DialogHeader>
                <div className="mt-2 max-h-[70vh] space-y-4 overflow-y-auto pr-1">
                    {CAPABILITY_SECTIONS.map((section) => (
                        <section key={section.title} className="space-y-2">
                            <h3 className="text-foreground text-xs font-semibold tracking-wide uppercase">
                                {section.title}
                            </h3>
                            <ul className="space-y-2">
                                {section.items.map((item) => (
                                    <li
                                        key={item}
                                        className="bg-muted/35 text-muted-foreground rounded-md px-3 py-2 text-sm">
                                        {item}
                                    </li>
                                ))}
                            </ul>
                        </section>
                    ))}
                </div>
                <DialogFooter showCloseButton />
            </DialogContent>
        </Dialog>
    );
}

export { AgentOperationsHelpDialog };
