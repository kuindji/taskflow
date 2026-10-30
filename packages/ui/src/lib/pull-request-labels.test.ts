import { expect, test } from "bun:test";
import type { TaskWorktreePr } from "@taskflow/shared";
import { pullRequestLabels } from "./pull-request-labels";
test("GitLab uses MR and a merge request agent instruction", () => {
    expect(pullRequestLabels("gitlab")).toEqual({
        short: "MR",
        create: "Create MR",
        title: "Create Merge Request",
        titleField: "MR Title",
        agentInstruction: "Create a merge request after pushing.",
    });
});
test("old metadata without provider uses GitHub labels", () => {
    const legacy: TaskWorktreePr = { number: 1, url: "https://github.com/g/r/pull/1" };
    expect(pullRequestLabels(legacy.provider ?? "github")).toEqual({
        short: "PR",
        create: "Create PR",
        title: "Create Pull Request",
        titleField: "PR Title",
        agentInstruction: "Create a pull request after pushing.",
    });
});
test("an unknown provider uses Request until resolution", () => {
    expect(pullRequestLabels(null)).toEqual({
        short: "Request",
        create: "Create Request",
        title: "Create Request",
        titleField: "Request Title",
        agentInstruction: "Create a request after pushing.",
    });
});
