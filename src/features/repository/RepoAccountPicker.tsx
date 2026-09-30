import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { SelectClipText } from "@/components/select-clip-text";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  forgeAccountBindRepo, forgeAccountBindingForRepo,
  forgeAccountRegisterCli, forgeAccounts,
  forgeAccountRepoTarget,
} from "@/lib/git/api";
import { useAccountsHealth, useGhAccounts } from "@/lib/git/queries";
import type { ForgeAccount } from "@/lib/git/types";
import { useTranslation } from "@/lib/i18n";
import { toastError } from "@/lib/toast";

const DEFAULT_ACCOUNT = "__default__";

export function RepoAccountPicker({ repoPath }: { repoPath: string }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const target = useQuery({
    queryKey: ["repo", repoPath, "forge-account-target"],
    queryFn: () => forgeAccountRepoTarget(repoPath), retry: false,
  });
  const accounts = useQuery({ queryKey: ["forge-accounts"], queryFn: forgeAccounts, retry: false });
  const binding = useQuery({
    queryKey: ["repo", repoPath, "forge-account-binding"],
    queryFn: () => forgeAccountBindingForRepo(repoPath),
    retry: false,
  });
  const gh = useGhAccounts();
  const health = useAccountsHealth();
  const [busy, setBusy] = useState(false);
  const provider = target.data?.provider;
  const host = target.data?.host;

  const available = useMemo(() => {
    if (!provider || !host) return [] as ForgeAccount[];
    const listed = (accounts.data ?? []).filter(
      (account) => account.provider === provider && account.host.toLowerCase() === host.toLowerCase(),
    );
    if (provider === "github") {
      for (const account of gh.data?.accounts ?? []) {
        if (!account.host || account.host.toLowerCase() !== host.toLowerCase()) continue;
        if (listed.some((item) => item.login === account.login)) continue;
        listed.push({ id: `cli:${host}:${account.login}`, provider, host, login: account.login, source: "cli", email: null, isActive: account.active });
      }
    }
    if (provider === "gitlab") {
      for (const account of health.data ?? []) {
        if (account.provider !== "gitlab" || !account.login || account.host.toLowerCase() !== host.toLowerCase()) continue;
        if (listed.some((item) => item.login === account.login)) continue;
        listed.push({ id: `cli:${host}:${account.login}`, provider, host, login: account.login, source: "cli", email: null, isActive: Boolean(account.active) });
      }
    }
    return listed;
  }, [accounts.data, gh.data, health.data, host, provider]);

  if (!provider || !host || available.length === 0) return null;

  async function selectAccount(value: string | null) {
    if (!value || busy) return;
    setBusy(true);
    try {
      const selected = available.find((account) => account.id === value);
      let id: string | null = value === DEFAULT_ACCOUNT ? null : value;
      if (selected?.id.startsWith("cli:")) {
        const account = await forgeAccountRegisterCli(selected.provider as "github" | "gitlab", selected.host, selected.login);
        id = account.id;
      }
      await forgeAccountBindRepo(repoPath, id);
      await queryClient.invalidateQueries();
    } catch (error) {
      console.error("Repository account selection failed:", error);
      toastError(error);
    } finally {
      setBusy(false);
    }
  }

  const value = binding.data ?? DEFAULT_ACCOUNT;
  const items = Object.fromEntries([
    [DEFAULT_ACCOUNT, t("accountSettings.defaultAccount")],
    ...available.map((account) => [account.id, `${account.login} · ${account.host}`]),
  ]);

  return (
    <Select items={items} value={value} onValueChange={selectAccount} disabled={busy || binding.isPending}>
      <SelectTrigger className="max-w-44" aria-label={t("accountSettings.repositoryAccount")} title={t("accountSettings.repositoryAccount")}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={DEFAULT_ACCOUNT}>{t("accountSettings.defaultAccount")}</SelectItem>
        {available.map((account) => (
          <SelectItem key={account.id} value={account.id}>
            <SelectClipText>{`${account.login} · ${account.host}`}</SelectClipText>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
