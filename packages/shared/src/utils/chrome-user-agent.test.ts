import { expect, test } from "bun:test";
import { toChromeUserAgent } from "./chrome-user-agent";

test("strips Electron and Taskflow tokens and keeps Chrome", () => {
    expect(
        toChromeUserAgent(
            "Mozilla/5.0 Taskflow/0.15.6 Chrome/130.0.0.0 Electron/33.4.11 Safari/537.36",
        ),
    ).toBe("Mozilla/5.0 Chrome/130.0.0.0 Safari/537.36");
});
