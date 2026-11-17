import type {
    ConfigureWebAuthnOptions,
    SelectWebauthnAccountDetails,
    WebAuthnAccount,
} from "electron";

/** Must match `keychain-access-groups` in `entitlements.mac.plist`. */
export const WEBAUTHN_KEYCHAIN_ACCESS_GROUP = "9SX8S58CA8.com.kuindji.taskflow.webauthn";

interface WebAuthnDeps {
    platform: NodeJS.Platform;
    isPackaged: boolean;
    configure(options: ConfigureWebAuthnOptions): void;
    warn(message: string, error?: unknown): void;
}

/**
 * Turns on the Touch ID platform authenticator for browser tabs. Only signed
 * macOS builds carry the keychain entitlement, so unsigned dev runs skip it.
 * Returns whether Touch ID is configured.
 */
export function configureTouchIdWebAuthn(deps: WebAuthnDeps): boolean {
    if (deps.platform !== "darwin" || !deps.isPackaged) return false;
    try {
        deps.configure({
            touchID: {
                keychainAccessGroup: WEBAUTHN_KEYCHAIN_ACCESS_GROUP,
                promptReason: "sign in to $1",
            },
        });
        return true;
    } catch (error) {
        deps.warn("Touch ID passkeys are unavailable:", error);
        return false;
    }
}

function accountLabel(account: WebAuthnAccount): string {
    return account.name || account.displayName || `Passkey ${account.credentialId.slice(0, 8)}`;
}

/**
 * Answers `select-webauthn-account`: one account is used as is, several are
 * offered through `choose`. Anything else cancels. `callback` runs exactly once.
 */
export async function handleWebAuthnAccountSelection(
    details: Pick<SelectWebauthnAccountDetails, "relyingPartyId" | "accounts">,
    callback: (credentialId?: string | null) => void,
    choose: (relyingPartyId: string, labels: string[]) => Promise<number | null>,
    warn: (message: string, error?: unknown) => void,
): Promise<void> {
    let credentialId: string | undefined;
    try {
        const { accounts } = details;
        if (accounts.length === 1) {
            credentialId = accounts[0]?.credentialId;
        } else if (accounts.length > 1) {
            const index = await choose(details.relyingPartyId, accounts.map(accountLabel));
            credentialId = index === null ? undefined : accounts[index]?.credentialId;
        }
    } catch (error) {
        warn("Passkey account selection failed:", error);
    } finally {
        if (credentialId === undefined) callback();
        else callback(credentialId);
    }
}
