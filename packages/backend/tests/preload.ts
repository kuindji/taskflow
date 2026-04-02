import { mkdtempSync, mkdirSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

const testHome = mkdtempSync(join(tmpdir(), "taskflow-test-home-"));
const xdgConfigHome = join(testHome, ".config");
const xdgStateHome = join(testHome, ".local", "state");
const xdgCacheHome = join(testHome, ".cache");

mkdirSync(xdgConfigHome, { recursive: true });
mkdirSync(xdgStateHome, { recursive: true });
mkdirSync(xdgCacheHome, { recursive: true });

process.env.HOME = testHome;
process.env.XDG_CONFIG_HOME = xdgConfigHome;
process.env.XDG_STATE_HOME = xdgStateHome;
process.env.XDG_CACHE_HOME = xdgCacheHome;

process.on("exit", () => {
    rmSync(testHome, { recursive: true, force: true });
});
