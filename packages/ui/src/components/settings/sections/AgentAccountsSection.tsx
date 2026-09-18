import { useCallback, useEffect, useRef, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import type { AccountAgentType, AgentAccount } from "@taskflow/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ConfirmDeleteDialog } from "@/components/ui/confirm-delete-dialog";
import { AgentAccountSelect } from "@/components/shared/AgentAccountSelect";

interface AgentAccountsSectionProps {
    agent: AccountAgentType;
    /** Saved accounts; local draft rows are kept until they are complete. */
    accounts: AgentAccount[];
    defaultAccount: string;
    onUpdate: (patch: { accounts?: AgentAccount[]; defaultAccount?: string }) => Promise<void>;
}

const AGENT_LABELS: Record<AccountAgentType, string> = { claude: "Claude", codex: "Codex" };
const HOME_DIR_PLACEHOLDERS: Record<AccountAgentType, string> = {
    claude: "/Users/you/.claude-work",
    codex: "/Users/you/.codex-work",
};

function AgentAccountsSection({
    agent,
    accounts,
    defaultAccount,
    onUpdate,
}: AgentAccountsSectionProps) {
    const [drafts, setDrafts] = useState<AgentAccount[]>(accounts);
    const [pendingDelete, setPendingDelete] = useState<AgentAccount | null>(null);
    const [error, setError] = useState<string | null>(null);

    // Saved accounts win: a completed row round-trips through the backend and
    // comes back as a new `accounts` array. Rows that are not saved yet and
    // are still incomplete are kept, because every save (including one from
    // another settings section) republishes the whole settings object and so
    // hands this section a fresh `accounts` array -- replacing drafts outright
    // would wipe a half-filled row the user is still typing into.
    useEffect(() => {
        setDrafts((prev) => {
            const savedIds = new Set(accounts.map((account) => account.id));
            const pending = prev.filter(
                (row) => !savedIds.has(row.id) && !(row.name.trim() && row.homeDir.trim()),
            );
            return [...accounts, ...pending];
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
    // same tick as the change that triggered the commit.
    const commit = useCallback(
        (next: AgentAccount[]) => {
            const complete = next
                .filter((row) => row.name.trim() && row.homeDir.trim())
                .map((row) => ({ ...row, name: row.name.trim(), homeDir: row.homeDir.trim() }));
            setError(null);
            onUpdate({ accounts: complete }).catch((e: unknown) =>
                setError(e instanceof Error ? e.message : String(e)),
            );
        },
        [onUpdate],
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
            const saved = accounts.find((account) => account.id === id);
            if (saved && saved.name === name && saved.homeDir === homeDir) return;
            commit(next);
        },
        [accounts, commit],
    );

    const handleBrowse = useCallback(
        async (id: string) => {
            const selected = await window.taskflow?.selectProjectDirectory();
            if (!selected) return;
            const next = draftsRef.current.map((row) =>
                row.id === id ? { ...row, homeDir: selected } : row,
            );
            setDrafts(next);
            commit(next);
        },
        [commit],
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
                        {hasPicker && (
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={() => void handleBrowse(account.id)}>
                                Browse
                            </Button>
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
