import { describe, expect, test } from "bun:test";
import { completePath } from "./path-input";

interface FakeEntry {
    name: string;
    directory: boolean;
}

function fakeDeps(tree: Record<string, FakeEntry[]>) {
    const reads: string[] = [];
    return {
        reads,
        deps: {
            home: "/Users/me",
            readdir: (dir: string) => {
                reads.push(dir);
                const entries = tree[dir];
                if (!entries) return Promise.reject(new Error(`ENOENT: ${dir}`));
                return Promise.resolve(
                    entries.map((entry) => ({
                        name: entry.name,
                        isDirectory: () => entry.directory,
                    })),
                );
            },
        },
    };
}

const home: FakeEntry[] = [
    { name: "Projects", directory: true },
    { name: "Prototypes", directory: true },
    { name: "Profile.txt", directory: false },
    { name: ".profile-cache", directory: true },
    { name: "Documents", directory: true },
];

describe("completePath", () => {
    test("stops at the longest common prefix and lists every match", async () => {
        const { deps, reads } = fakeDeps({ "/Users/me/": home });
        expect(await completePath("~/Pro", deps)).toEqual({
            value: "~/Pro",
            candidates: ["Projects", "Prototypes"],
        });
        expect(reads).toEqual(["/Users/me/"]);
    });

    test("completes a unique directory and appends a slash", async () => {
        const { deps } = fakeDeps({ "/Users/me/": home });
        expect(await completePath("~/Proj", deps)).toEqual({
            value: "~/Projects/",
            candidates: ["Projects"],
        });
    });

    test("never offers files", async () => {
        const { deps } = fakeDeps({ "/Users/me/": home });
        expect(await completePath("~/Profile", deps)).toEqual({
            value: "~/Profile",
            candidates: [],
        });
    });

    test("hides dot-directories unless the typed segment starts with a dot", async () => {
        const { deps } = fakeDeps({ "/Users/me/": home });
        expect((await completePath("~/", deps)).candidates).toEqual([
            "Documents",
            "Projects",
            "Prototypes",
        ]);
        expect(await completePath("~/.pro", deps)).toEqual({
            value: "~/.profile-cache/",
            candidates: [".profile-cache"],
        });
    });

    test("completes absolute paths and leaves an unreadable directory as typed", async () => {
        const { deps } = fakeDeps({ "/srv/": [{ name: "apps", directory: true }] });
        expect(await completePath("/srv/a", deps)).toEqual({
            value: "/srv/apps/",
            candidates: ["apps"],
        });
        expect(await completePath("/missing/x", deps)).toEqual({
            value: "/missing/x",
            candidates: [],
        });
    });
});
