import { useCallback, useEffect, useRef, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import {
    DEFAULT_AGENT_ACCOUNT_ID,
    type CodexAccountStatus,
    type AccountAgentType,
    type AgentAccount,
} from "@taskflow/shared";
import { loadCodexDiscovery } from "@/lib/agent-discovery";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ConfirmDeleteDialog } from "@/components/ui/confirm-delete-dialog";
import { AgentAccountSelect } from "@/components/shared/AgentAccountSelect";
import { useLocalOnlyHint } from "@/hooks/useIsLocalBackend";

interface AgentAccountsSectionProps {
    backendId?: string | null;
    loadDiscovery?: typeof loadCodexDiscovery;
    agent: AccountAgentType;
    /** Saved accounts; local draft rows are kept until they are saved. */
    accounts: AgentAccount[];
    defaultAccount: string;
    onUpdate: (patch: { accounts?: AgentAccount[]; defaultAccount?: string }) => Promise<void>;
}

const AGENT_LABELS: Record<AccountAgentType, string> = { claude: "Claude", codex: "Codex" };
const HOME_DIR_PLACEHOLDERS: Record<AccountAgentType, string> = {
    claude: "/Users/you/.claude-work",
    codex: "/Users/you/.codex-work",
};

function CodexAccountDiagnostic({
    backendId,
    account,
    loadDiscovery,
}: {
    backendId?: string | null;
    account: string;
    loadDiscovery: typeof loadCodexDiscovery;
}) {
    const [status, setStatus] = useState<CodexAccountStatus | null>(null);
    useEffect(() => {
        let cancelled = false;
        if (!backendId) {
            setStatus({ state: "unknown" });
            return;
        }
        loadDiscovery(backendId, { account }).then(
            (response) => {
                if (!cancelled) setStatus(response.account);
            },
            () => {
                if (!cancelled) setStatus({ state: "unknown" });
            },
        );
        return () => {
            cancelled = true;
        };
    }, [backendId, account, loadDiscovery]);
    const text =
        status === null
            ? "Checking sign-in..."
            : status.state === "signed-in"
              ? `signed in as ${status.label}`
              : status.state === "signed-out"
                ? "not signed in"
                : "Sign-in status unavailable";
    return <span className="text-muted-foreground text-xs">{text}</span>;
}

function AgentAccountsSection({
    agent,
    backendId,
    loadDiscovery = loadCodexDiscovery,
    accounts,
    defaultAccount,
    onUpdate,
}: AgentAccountsSectionProps) {
    const [drafts, setDrafts] = useState<AgentAccount[]>(accounts);
    const [pendingDelete, setPendingDelete] = useState<AgentAccount | null>(null);
    const [error, setError] = useState<string | null>(null);

    // Every save (including one from another settings section) republishes the
    // whole settings object and so hands this section a fresh `accounts`
    // array. Saved values replace the rows, except fields the user has edited
    // since the value they were last saved or sent with (a save answers with
    // what was sent, and the user may have typed into the next field while it
    // was in flight), and fields still waiting for this section's latest save,
    // which an earlier save's answer must not undo. Rows that were never saved
    // are kept as they are; a saved row that is gone was deleted.
    const savedRef = useRef<AgentAccount[]>(accounts);
    const sentRef = useRef<AgentAccount[]>([]);
    // The latest list sent, until its save settles.
    const pendingRef = useRef<AgentAccount[] | null>(null);
    useEffect(() => {
        const previous = savedRef.current;
        savedRef.current = accounts;
        const sent = sentRef.current;
        const pending = pendingRef.current;
        setDrafts((prev) => {
            const savedIds = new Set(accounts.map((account) => account.id));
            const keep = (
                field: "name" | "homeDir",
                draft: AgentAccount,
                base: AgentAccount,
                account: AgentAccount,
            ): boolean => {
                const value = draft[field].trim();
                if (value !== base[field]) return true;
                const waiting = pending?.find((row) => row.id === account.id);
                return (
                    waiting !== undefined && waiting[field] === value && value !== account[field]
                );
            };
            const merged = accounts.map((account) => {
                const draft = prev.find((row) => row.id === account.id);
                const base =
                    previous.find((row) => row.id === account.id) ??
                    sent.find((row) => row.id === account.id);
                if (!draft || !base) return account;
                return {
                    ...account,
                    name: keep("name", draft, base, account) ? draft.name : account.name,
                    homeDir: keep("homeDir", draft, base, account)
                        ? draft.homeDir
                        : account.homeDir,
                };
            });
            const unsaved = prev.filter(
                (row) => !savedIds.has(row.id) && !previous.some((saved) => saved.id === row.id),
            );
            return [...merged, ...unsaved];
        });
    }, [accounts]);

    // Handlers run from events (blur, click, picker resolution) after the
    // render that produced them, so they read the rows from a ref rather than
    // closing over a `drafts` value that may already be a render behind.
    const draftsRef = useRef<AgentAccount[]>(drafts);
    useEffect(() => {
        draftsRef.current = drafts;
    }, [drafts]);

    // Works only on `next`, never on `drafts`: state may still be stale in the
    // same tick as the change that triggered the commit. The list sent replaces
    // the saved one, so a saved row the user has left half-cleared goes out as
    // saved; only a row that was never saved can be left out.
    const commit = useCallback(
        (next: AgentAccount[]) => {
            const complete = next.flatMap((row) => {
                const name = row.name.trim();
                const homeDir = row.homeDir.trim();
                if (name && homeDir) return [{ ...row, name, homeDir }];
                const saved = accounts.find((account) => account.id === row.id);
                return saved ? [saved] : [];
            });
            sentRef.current = complete;
            pendingRef.current = complete;
            const settle = () => {
                if (pendingRef.current === complete) pendingRef.current = null;
            };
            setError(null);
            onUpdate({ accounts: complete }).then(settle, (e: unknown) => {
                settle();
                setError(e instanceof Error ? e.message : String(e));
            });
        },
        [accounts, onUpdate],
    );

    const handleDefaultAccount = useCallback(
        (value: string) => {
            setError(null);
            onUpdate({ defaultAccount: value }).catch((e: unknown) =>
                setError(e instanceof Error ? e.message : String(e)),
            );
        },
        [onUpdate],
    );

    const handleField = useCallback((id: string, field: "name" | "homeDir", value: string) => {
        setDrafts((prev) => prev.map((row) => (row.id === id ? { ...row, [field]: value } : row)));
    }, []);

    const handleBlur = useCallback(
        (id: string) => {
            const next = draftsRef.current;
            const row = next.find((account) => account.id === id);
            if (!row) return;
            const name = row.name.trim();
            const homeDir = row.homeDir.trim();
            if (!name || !homeDir) return;
            // While a save is in flight its values are what the account is
            // about to become, so going back to the saved value is a change.
            const expected =
                pendingRef.current?.find((account) => account.id === id) ??
                accounts.find((account) => account.id === id);
            if (expected && expected.name === name && expected.homeDir === homeDir) return;
            commit(next);
        },
        [accounts, commit],
    );

    // The picker is this machine's native dialog, so its path is only good for
    // a backend on this machine.
    const localOnlyHint = useLocalOnlyHint(backendId ?? null);

    const handleBrowse = useCallback(
        async (id: string) => {
            if (localOnlyHint) return;
            const selected = await window.taskflow?.selectProjectDirectory();
            if (!selected) return;
            const next = draftsRef.current.map((row) =>
                row.id === id ? { ...row, homeDir: selected } : row,
            );
            setDrafts(next);
            commit(next);
        },
        [commit, localOnlyHint],
    );

    const handleAdd = useCallback(() => {
        setDrafts((prev) => [
            ...prev,
            { id: crypto.randomUUID(), name: `account ${prev.length + 1}`, homeDir: "" },
        ]);
    }, []);

    const handleConfirmDelete = useCallback(() => {
        if (!pendingDelete) return;
        const next = draftsRef.current.filter((account) => account.id !== pendingDelete.id);
        setDrafts(next);
        commit(next);
        setPendingDelete(null);
    }, [commit, pendingDelete]);

    const hasPicker = typeof window.taskflow?.selectProjectDirectory === "function";

    return (
        <div className="flex flex-col gap-2">
            <AgentAccountSelect
                label="Default Account"
                hint={`Account new ${AGENT_LABELS[agent]} sessions use unless a project or launch picks another`}
                accounts={accounts}
                value={defaultAccount}
                onChange={handleDefaultAccount}
            />
            {agent === "codex" && (
                <div className="flex items-center gap-2 text-[13px]">
                    <span>Default account</span>
                    <CodexAccountDiagnostic
                        key={JSON.stringify([backendId, DEFAULT_AGENT_ACCOUNT_ID])}
                        backendId={backendId}
                        account={DEFAULT_AGENT_ACCOUNT_ID}
                        loadDiscovery={loadDiscovery}
                    />
                </div>
            )}
            {drafts.map((account) => {
                const isDefault = account.id === defaultAccount;
                return (
                    <div key={account.id} className="flex items-center gap-1.5">
                        <Input
                            id={`${agent}-account-name-${account.id}`}
                            size="sm"
                            className="w-40 text-[13px]"
                            value={account.name}
                            placeholder="Account name"
                            aria-label={`Account name for ${account.name}`}
                            onChange={(e) => handleField(account.id, "name", e.target.value)}
                            onBlur={() => handleBlur(account.id)}
                        />
                        <Input
                            id={`${agent}-account-home-${account.id}`}
                            size="sm"
                            className="flex-1 text-[13px]"
                            value={account.homeDir}
                            placeholder={HOME_DIR_PLACEHOLDERS[agent]}
                            aria-label={`Home directory for ${account.name}`}
                            onChange={(e) => handleField(account.id, "homeDir", e.target.value)}
                            onBlur={() => handleBlur(account.id)}
                        />
                        {agent === "codex" && accounts.some((saved) => saved.id === account.id) && (
                            <CodexAccountDiagnostic
                                key={JSON.stringify([
                                    backendId,
                                    account.id,
                                    accounts.find((saved) => saved.id === account.id)?.homeDir,
                                ])}
                                backendId={backendId}
                                account={account.id}
                                loadDiscovery={loadDiscovery}
                            />
                        )}
                        {hasPicker && (
                            // A disabled button takes no pointer events, so the wrapper carries the tooltip.
                            <span title={localOnlyHint ?? undefined}>
                                <Button
                                    variant="outline"
                                    size="sm"
                                    disabled={localOnlyHint !== null}
                                    onClick={() => void handleBrowse(account.id)}>
                                    Browse
                                </Button>
                            </span>
                        )}
                        <Button
                            variant="ghost"
                            size="icon-sm"
                            disabled={isDefault}
                            title={isDefault ? "Choose another default account first" : undefined}
                            aria-label={`Delete account ${account.name}`}
                            onClick={() => setPendingDelete(account)}>
                            <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                    </div>
                );
            })}
            {error && <p className="text-destructive text-xs">{error}</p>}
            <div>
                <Button variant="outline" size="sm" onClick={handleAdd}>
                    <Plus className="h-3.5 w-3.5" />
                    Add account
                </Button>
            </div>
            <ConfirmDeleteDialog
                open={pendingDelete !== null}
                onOpenChange={(open) => {
                    if (!open) setPendingDelete(null);
                }}
                onConfirm={handleConfirmDelete}
                title={`Delete account "${pendingDelete?.name ?? ""}"?`}
                description="Projects, actions and schedules that use this account will fail to launch until you pick another one."
            />
        </div>
    );
}

export { AgentAccountsSection };
