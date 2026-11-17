import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
    configureTouchIdWebAuthn,
    handleWebAuthnAccountSelection,
    WEBAUTHN_KEYCHAIN_ACCESS_GROUP,
} from "./webauthn";

const options = {
    touchID: {
        keychainAccessGroup: "9SX8S58CA8.com.kuindji.taskflow.webauthn",
        promptReason: "sign in to $1",
    },
};

test("configures Touch ID on packaged macOS", () => {
    const calls: unknown[] = [];
    const ok = configureTouchIdWebAuthn({
        platform: "darwin",
        isPackaged: true,
        configure: (o) => calls.push(o),
        warn: () => {},
    });
    expect(ok).toBe(true);
    expect(calls).toEqual([options]);
});
test("skips unsigned dev runs", () => {
    const calls: unknown[] = [];
    expect(
        configureTouchIdWebAuthn({
            platform: "darwin",
            isPackaged: false,
            configure: (o) => calls.push(o),
            warn: () => {},
        }),
    ).toBe(false);
    expect(calls).toEqual([]);
});
test("skips other platforms", () => {
    const calls: unknown[] = [];
    expect(
        configureTouchIdWebAuthn({
            platform: "win32",
            isPackaged: true,
            configure: (o) => calls.push(o),
            warn: () => {},
        }),
    ).toBe(false);
    expect(calls).toEqual([]);
});
test("a throwing configure is logged, not fatal", () => {
    const warnings: string[] = [];
    const ok = configureTouchIdWebAuthn({
        platform: "darwin",
        isPackaged: true,
        configure: () => {
            throw new Error("no entitlement");
        },
        warn: (m) => warnings.push(m),
    });
    expect(ok).toBe(false);
    expect(warnings).toHaveLength(1);
});
test("the access group matches the entitlement", () => {
    const plist = readFileSync(join(import.meta.dir, "..", "entitlements.mac.plist"), "utf8");
    expect(plist).toContain(`<string>${WEBAUTHN_KEYCHAIN_ACCESS_GROUP}</string>`);
});

// Account selection. `answers` records every callback argument; each test checks it ran exactly once.
const alice = { credentialId: "aaaaaaaaaaaa", name: "alice@example.com" };
const bob = { credentialId: "bbbbbbbbbbbb", displayName: "Bob" };
const anon = { credentialId: "cccccccccccc" };
function run(
    accounts: Electron.WebAuthnAccount[],
    choose: (rp: string, labels: string[]) => Promise<number | null>,
) {
    const answers: unknown[] = [];
    const warnings: string[] = [];
    const done = handleWebAuthnAccountSelection(
        { relyingPartyId: "example.com", accounts },
        (id) => answers.push(id),
        choose,
        (m) => warnings.push(m),
    );
    return { answers, warnings, done };
}
test("a single account is picked without asking", async () => {
    let asked = false;
    const r = run([alice], async () => {
        asked = true;
        return 0;
    });
    await r.done;
    expect(asked).toBe(false);
    expect(r.answers).toEqual(["aaaaaaaaaaaa"]);
});
test("several accounts ask, with readable labels", async () => {
    let seen: [string, string[]] | undefined;
    const r = run([alice, bob, anon], async (rp, labels) => {
        seen = [rp, labels];
        return 1;
    });
    await r.done;
    expect(seen).toEqual(["example.com", ["alice@example.com", "Bob", "Passkey cccccccc"]]);
    expect(r.answers).toEqual(["bbbbbbbbbbbb"]);
});
test("cancelling the choice cancels the request", async () => {
    const r = run([alice, bob], async () => null);
    await r.done;
    expect(r.answers).toEqual([undefined]);
});
test("an out-of-range choice cancels the request", async () => {
    const r = run([alice, bob], async () => 5);
    await r.done;
    expect(r.answers).toEqual([undefined]);
});
test("a failing chooser is logged and cancels", async () => {
    const r = run([alice, bob], async () => {
        throw new Error("no window");
    });
    await r.done;
    expect(r.answers).toEqual([undefined]);
    expect(r.warnings).toHaveLength(1);
});
test("no accounts cancels without asking", async () => {
    let asked = false;
    const r = run([], async () => {
        asked = true;
        return 0;
    });
    await r.done;
    expect(asked).toBe(false);
    expect(r.answers).toEqual([undefined]);
});
