import { useQuery } from "@tanstack/react-query";
import { SelectClipText } from "@/components/select-clip-text";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { forgeAccountRegisterCli, forgeAccounts } from "@/lib/git/api";
import { useAccountsHealth, useGhAccounts } from "@/lib/git/queries";
import type { ForgeProvider } from "@/lib/git/types";
import { useTranslation } from "@/lib/i18n";

const DEFAULT = "__default__";

export async function resolveCloneAccount(value: string | null): Promise<string | null> {
  if (!value || value === DEFAULT) return null;
  if (!value.startsWith("cli|")) return value;
  const [provider, host, ...login] = value.slice(4).split("|");
  if ((provider !== "github" && provider !== "gitlab") || !host || login.length === 0) {
    throw new Error("Invalid CLI account selection");
  }
  return (await forgeAccountRegisterCli(provider, host, login.join("|"))).id;
}

export function CloneAccountPicker({ provider, url, value, onChange }: {
  provider: ForgeProvider;
  url: string;
  value: string | null;
  onChange: (value: string | null) => void;
}) {
  const { t } = useTranslation();
  const accounts = useQuery({ queryKey: ["forge-accounts"], queryFn: forgeAccounts, retry: false });
  const gh = useGhAccounts();
  const health = useAccountsHealth();
  let host = "";
  try { host = new URL(url).host.toLowerCase(); }
  catch (error) { console.error("Clone URL host unavailable:", error); }
  if (!host) return null;
  const options = (accounts.data ?? [])
    .filter((account) => account.provider === provider && account.host.toLowerCase() === host)
    .map((account) => ({ value: account.id, login: account.login }));
  if (provider === "github") {
    for (const account of gh.data?.accounts ?? []) {
      if (account.host.toLowerCase() === host && !options.some((option) => option.login === account.login)) {
        options.push({ value: `cli|github|${host}|${account.login}`, login: account.login });
      }
    }
  }
  if (provider === "gitlab") {
    for (const account of health.data ?? []) {
      if (account.provider === "gitlab" && account.host.toLowerCase() === host && account.login
          && !options.some((option) => option.login === account.login)) {
        options.push({ value: `cli|gitlab|${host}|${account.login}`, login: account.login });
      }
    }
  }
  if (options.length === 0) return null;
  const items = Object.fromEntries([
    [DEFAULT, t("accountSettings.defaultAccount")],
    ...options.map((option) => [option.value, option.login]),
  ]);
  return (
    <Select items={items} value={value ?? DEFAULT} onValueChange={onChange}>
      <SelectTrigger className="w-full" aria-label={t("accountSettings.cloneAccount")}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={DEFAULT}>{t("accountSettings.defaultAccount")}</SelectItem>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            <SelectClipText>{option.login}</SelectClipText>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
