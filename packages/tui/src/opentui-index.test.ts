import { describe, expect, it } from "bun:test";
import { readFile } from "fs/promises";
import type { ActionDefinition } from "@taskflow/shared";
import { editorActions } from "./opentui/entry";

const timestamp = "2026-08-25T00:00:00.000Z";

function action(id: string, projectId?: string): ActionDefinition {
    return {
        id,
        projectId,
        name: id,
        prompt: "echo ok",
        sessionType: "shell",
        createdAt: timestamp,
        updatedAt: timestamp,
    };
}

describe("TUI entry point", () => {
    it("reports CLI errors before touching the terminal", async () => {
        const proc = Bun.spawn([process.execPath, "run", "src/index.ts", "--bad"], {
            cwd: import.meta.dir.replace(/\/src$/, ""),
            stdout: "pipe",
            stderr: "pipe",
        });
        const [code, stdout, stderr] = await Promise.all([
            proc.exited,
            new Response(proc.stdout).text(),
            new Response(proc.stderr).text(),
        ]);
        expect(code).toBe(1);
        expect(stdout).not.toContain("\x1b[?1049h");
        expect(stderr).toContain("Unknown argument");
    });

    it("wires the production entry through SessionController", async () => {
        const source = await readFile(new URL("./opentui/entry.ts", import.meta.url), "utf-8");
        expect(source).toContain("new SessionController");
        expect(source).not.toContain("sessions: []");
    });

    it("keeps master flow editing global while schedule editing can resolve project actions", () => {
        const actions = [action("global"), action("project", "p1")];
        const owner = { kind: "master" } as const;

        expect(editorActions("flow", actions, owner).map((item) => item.id)).toEqual(["global"]);
        expect(editorActions("schedule", actions, owner).map((item) => item.id)).toEqual([
            "global",
            "project",
        ]);
    });
});
