import { expect, it } from "bun:test";
import { mkdtemp, rm } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { config, updateConfigDataDir } from "../../src/config";

it("keeps dev server records in the local config dir, one file per instance", () => {
    expect(config.devServersFile).toBe(
        join(config.baseDir, `dev-servers-${config.instanceId}.json`),
    );
});

it("doesn't move dev server records when the data dir changes", async () => {
    const before = config.devServersFile;
    const original = config.dataDir;
    const elsewhere = await mkdtemp(join(tmpdir(), "taskflow-data-"));
    try {
        updateConfigDataDir(elsewhere);
        expect(config.dataDir).toBe(elsewhere);
        expect(config.devServersFile).toBe(before);
    } finally {
        updateConfigDataDir(original);
        await rm(elsewhere, { recursive: true, force: true });
    }
});
