import { describe, expect, test } from "bun:test";
import { splitAttrArgs } from "../../src/services/attr-args";

describe("splitAttrArgs", () => {
    test("list (0/0): everything goes to flagArgs, even a bare positional", () => {
        const result = splitAttrArgs(["foo", "--task-id", "T1"], 0, 0);
        expect(result).toEqual({ positional: [], flagArgs: ["foo", "--task-id", "T1"] });
    });

    test("list (0/0): --own alone still goes to flagArgs", () => {
        const result = splitAttrArgs(["--own", "--task-id", "T1"], 0, 0);
        expect(result).toEqual({ positional: [], flagArgs: ["--own", "--task-id", "T1"] });
    });

    test("get (1/1): a plain id is collected", () => {
        const result = splitAttrArgs(["A1", "--task-id", "T1"], 1, 1);
        expect(result).toEqual({ positional: ["A1"], flagArgs: ["--task-id", "T1"] });
    });

    test("create (1/2): a flag-token name fills the required slot regardless", () => {
        const result = splitAttrArgs(["--own", "x", "--task-id", "T1"], 1, 2);
        expect(result).toEqual({ positional: ["--own", "x"], flagArgs: ["--task-id", "T1"] });
    });

    test("create (1/2): a flag-token value in the optional slot still stops (documented limitation)", () => {
        const result = splitAttrArgs(["name", "--project-id", "--task-id", "T1"], 1, 2);
        expect(result).toEqual({
            positional: ["name"],
            flagArgs: ["--project-id", "--task-id", "T1"],
        });
    });

    test("create (1/2): a plain name and value are both collected", () => {
        const result = splitAttrArgs(["env", "prod", "--task-id", "T1"], 1, 2);
        expect(result).toEqual({ positional: ["env", "prod"], flagArgs: ["--task-id", "T1"] });
    });

    test("set (2/2): a flag-token value fills the second required slot", () => {
        const result = splitAttrArgs(["A1", "--project-id", "--task-id", "T1"], 2, 2);
        expect(result).toEqual({
            positional: ["A1", "--project-id"],
            flagArgs: ["--task-id", "T1"],
        });
    });

    test("rename (2/2): a flag-token name fills the second required slot", () => {
        const result = splitAttrArgs(["A1", "--task-id", "--task-id", "T1"], 2, 2);
        expect(result).toEqual({
            positional: ["A1", "--task-id"],
            flagArgs: ["--task-id", "T1"],
        });
    });

    test("delete (1/1): a flag-token id fills the sole required slot", () => {
        const result = splitAttrArgs(["--own", "--task-id", "T1"], 1, 1);
        expect(result).toEqual({ positional: ["--own"], flagArgs: ["--task-id", "T1"] });
    });

    test("no trailing flags: all positionals collected, flagArgs empty", () => {
        const result = splitAttrArgs(["A1", "value"], 2, 2);
        expect(result).toEqual({ positional: ["A1", "value"], flagArgs: [] });
    });
});
