import type { GitPrProvider } from "@taskflow/shared";

export function pullRequestLabels(provider: GitPrProvider | null): {
    short: "PR" | "MR" | "Request";
    create: string;
    title: string;
    titleField: string;
    agentInstruction: string;
} {
    if (provider === "gitlab")
        return {
            short: "MR",
            create: "Create MR",
            title: "Create Merge Request",
            titleField: "MR Title",
            agentInstruction: "Create a merge request after pushing.",
        };
    if (provider === "github")
        return {
            short: "PR",
            create: "Create PR",
            title: "Create Pull Request",
            titleField: "PR Title",
            agentInstruction: "Create a pull request after pushing.",
        };
    return {
        short: "Request",
        create: "Create Request",
        title: "Create Request",
        titleField: "Request Title",
        agentInstruction: "Create a request after pushing.",
    };
}

export function openPullRequestUrl(url: string) {
    if (window.taskflow) {
        void window.taskflow.openExternalUrl(url);
    } else {
        window.open(url, "_blank");
    }
}
