import { expect, it } from "bun:test";
import { join } from "path";
import { config } from "../../src/config";

it("keeps dev server records in the local config dir, one file per instance", () => {
    expect(config.devServersFile).toBe(
        join(config.baseDir, `dev-servers-${config.instanceId}.json`),
    );
});
