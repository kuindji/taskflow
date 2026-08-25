import { describe, expect, it } from "bun:test";
import {
    editRecord,
    splitCommand,
    withValidationError,
    type ExternalEditorDeps,
} from "./external-editor";

interface Harness {
    deps: ExternalEditorDeps;
    calls: string[];
    files: Map<string, string>;
    exits: number[];
}

function harness(): Harness {
    const calls: string[] = [];
    const files = new Map<string, string>();
    const exits: number[] = [];
    return {
        calls,
        files,
        exits,
        deps: {
            filesystem: {
                mkdtemp: async () => {
                    calls.push("mkdtemp");
                    return "/tmp/private-editor";
                },
                readFile: async (path) => files.get(path) ?? "",
                writeFile: async (path, contents) => {
                    calls.push(
                        `write:${contents.includes("validation errors") ? "error" : "body"}`,
                    );
                    files.set(path, contents);
                },
                rm: async () => {
                    calls.push("rm");
                },
            },
            renderer: {
                suspend: () => {
                    calls.push("suspend");
                },
                resume: () => {
                    calls.push("resume");
                },
                requestRender: () => calls.push("render"),
            },
            editor: "code --wait",
            tempRoot: "/tmp",
            blur: () => calls.push("blur"),
            restoreFocus: () => calls.push("focus"),
            runEditor: async (command, args) => {
                calls.push(`editor:${command}:${args.join(",")}`);
                return exits.shift() ?? 0;
            },
        },
    };
}

describe("external editor", () => {
    it("splits configured editor arguments", () => {
        expect(splitCommand('code --wait "--profile=Task Flow"')).toEqual([
            "code",
            "--wait",
            "--profile=Task Flow",
        ]);
    });

    it("suspends, saves, resumes, and cleans up on success", async () => {
        const test = harness();
        const result = await editRecord({
            filename: "action.yaml",
            initialContents: "name: Good\n",
            validate: (contents) => contents,
            save: async () => {
                test.calls.push("save");
            },
            deps: test.deps,
        });
        expect(result).toBe("name: Good\n");
        expect(test.calls).toEqual([
            "mkdtemp",
            "write:body",
            "blur",
            "suspend",
            "editor:code:--wait",
            "resume",
            "focus",
            "render",
            "save",
            "rm",
        ]);
    });

    it("reopens the same file after validation and backend errors", async () => {
        const test = harness();
        let validationCount = 0;
        let saveCount = 0;
        const result = await editRecord({
            filename: "flow.yaml",
            initialContents: "name: Flow\n",
            validate: (contents) => {
                validationCount += 1;
                if (validationCount === 1) throw new Error("name is invalid");
                return contents;
            },
            save: async () => {
                saveCount += 1;
                if (saveCount === 1) throw new Error("backend rejected save");
            },
            deps: test.deps,
        });
        expect(result).toContain("taskflow validation errors");
        expect(test.calls.filter((call) => call.startsWith("editor:"))).toHaveLength(3);
        expect(test.calls.filter((call) => call === "resume")).toHaveLength(3);
        expect(test.calls.at(-1)).toBe("rm");
        expect([...test.files.values()][0]).toContain("backend rejected save");
    });

    it("cancels on nonzero editor exit without saving and still cleans up", async () => {
        const test = harness();
        test.exits.push(2);
        const result = await editRecord({
            filename: "schedule.yaml",
            initialContents: "name: Schedule\n",
            validate: () => {
                throw new Error("must not validate");
            },
            save: async () => {
                test.calls.push("save");
            },
            deps: test.deps,
        });
        expect(result).toBeNull();
        expect(test.calls).not.toContain("save");
        expect(test.calls.slice(-4)).toEqual(["resume", "focus", "render", "rm"]);
    });

    it("replaces one delimited error block", () => {
        const once = withValidationError("name: Flow\n", "first");
        const twice = withValidationError(once, "second");
        expect(twice.match(/^# --- taskflow validation errors ---$/gm)).toHaveLength(1);
        expect(twice).not.toContain("first");
        expect(twice).toContain("second");
    });
});
