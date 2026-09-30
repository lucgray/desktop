import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSelector } from "@tanstack/react-store";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { DisabledReasonButton } from "@/components/disabled-reason-button";
import { useRelativeNow } from "@/components/relative-time";
import { StatusDetailChip } from "@/components/status-detail-chip";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { calendarDaysUntil } from "@/features/accounts/expiry";
import { copyText } from "@/lib/clipboard";
import { useAppForm } from "@/lib/form";
import {
  forgeAccountRemove,
  forgeAccountSelect,
  forgeAccounts,
  forgeGitlabAccountAdd,
  forgeBbClearAccount,
  forgeBbSetAccount,
  forgeCnbAccount,
  forgeCnbClearAccount,
  forgeCnbSetAccount,
  forgeListRepos,
} from "@/lib/git/api";
import {
  MY_WORK_SOURCES_KEY,
  myWorkPageKey,
  useAccountsHealth,
  useBbAccount,
  useClearGitlabReviewToken,
  useGhAccounts,
  useGitlabReviewBotStatus,
  useSetGitlabReviewToken,
  useSwitchAccount,
} from "@/lib/git/queries";
import {
  type GhAccount,
  rateLimitResetTime,
  type SessionHealth,
} from "@/lib/git/types";
import { setBitbucketTokenExpiresAt } from "@/lib/settings/api";
import { useSettings } from "@/lib/settings/queries";
import { useTranslation } from "@/lib/i18n";
import { useUiStore } from "@/lib/stores/ui";
import { errorMessage } from "@/lib/tauri/invoke";
import { toastError } from "@/lib/toast";

/** The GitLab CLI install docs — where the "install glab" affordance points. */
const GLAB_INSTALL_URL = "https://gitlab.com/gitlab-org/cli#installation";

/** Where a Bitbucket / Atlassian API token is created. */
const ATLASSIAN_TOKEN_URL =
  "https://id.atlassian.com/manage-profile/security/api-tokens";

/** GitLab docs for minting a project/group access token (the review-bot token). */
const GITLAB_PROJECT_TOKEN_URL =
  "https://docs.gitlab.com/ee/user/project/settings/project_access_tokens.html";

/** The scopes a token needs for full Bitbucket support: the read scopes that power
 *  browsing/PR/Pipeline reads, the write/admin scopes for acting on PRs and Pipelines,
 *  and the repository admin/delete + webhook scopes that power repository management
 *  (publish, settings, branch restrictions, default reviewers, webhooks, delete). A
 *  write fails with a clear message if the token lacks the matching scope. */
const BB_SCOPES = [
  "read:user:bitbucket",
  "read:workspace:bitbucket",
  "read:repository:bitbucket",
  "write:repository:bitbucket",
  "admin:repository:bitbucket",
  "delete:repository:bitbucket",
  "read:pullrequest:bitbucket",
  "write:pullrequest:bitbucket",
  "read:pipeline:bitbucket",
  "write:pipeline:bitbucket",
  "admin:pipeline:bitbucket",
  "read:webhook:bitbucket",
  "write:webhook:bitbucket",
  "delete:webhook:bitbucket",
];

/** A `YYYY-MM-DD` string rendered in the user's locale ("Jul 30, 2026"); falls
 *  back to the raw string if it can't be parsed. */
function formatDate(date: string): string {
  const t = Date.parse(`${date}T00:00:00`);
  if (Number.isNaN(t)) return date;
  return new Date(t).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

/** A rate-limited badge's detail: the forge's own message, then when access
 *  resumes. No Reconnect rides this state — the credential is fine. */
function rateLimitDetail(
  health: SessionHealth,
  now: number,
  t: ReturnType<typeof useTranslation>["t"],
): string | undefined {
  const resumesAt = rateLimitResetTime(health.resetAt, now);
  const lines = [
    health.detail,
    resumesAt ? t("accountSettings.accessResumesAt", { time: resumesAt }) : null,
  ].filter((line): line is string => Boolean(line));
  return lines.length > 0 ? lines.join("\n") : undefined;
}

/** Whether this gh supports multiple accounts (`gh auth switch`, 2.40+). */
function supportsSwitching(version: string): boolean {
  const [major = 0, minor = 0] = version.split(".").map(Number);
  return major > 2 || (major === 2 && minor >= 40);
}

/**
 * Sign-in settings for the hosted providers: the GitHub CLI accounts (switch the
 * active account per host), a GitLab review-bot token (so AI reviews post as the
 * project bot rather than the signed-in `glab` account), and a Bitbucket Cloud
 * account (an Atlassian API token in the OS keychain). GitLab's day-to-day
 * sign-in is still CLI-driven like GitHub (via `glab auth login`).
 */
export function AccountsSection() {
  return (
    <div className="space-y-8">
      <UnifiedAccounts />
      <GitHubAccounts />
      <GitLabAccount />
      <BitbucketAccount />
      <CnbAccount />
    </div>
  );
}

/**
 * GitHub accounts known to the gh CLI. Switching changes which account
 * every GitHub feature acts as — immediately, like API keys.
 */
function GitHubAccounts() {
  const { t } = useTranslation();
  const accounts = useGhAccounts();
  const switchAccount = useSwitchAccount();
  const health = useAccountsHealth();
  const openReconnect = useUiStore((s) => s.openReconnect);
  const now = useRelativeNow();

  const version = accounts.data?.version ?? "";
  const canSwitch = supportsSwitching(version);
  const list = accounts.data?.accounts ?? [];

  // Merge the health probe onto each account by host+login. Only `broken` and
  // `rateLimited` surface (silence is health — no "ok" chip); "offline" and
  // everything else read as fine, so a network blip never badges a good account.
  const healthByKey = useMemo(() => {
    const map = new Map<string, SessionHealth>();
    for (const h of health.data ?? []) {
      if (h.provider === "github") map.set(`${h.host}/${h.login}`, h);
    }
    return map;
  }, [health.data]);

  // Group accounts by host so a developer with both github.com and an
  // Enterprise account sees the active one per host. github.com first, then
  // alphabetical. A single-host user (today's common case) gets no subhead.
  const groups = useMemo(() => {
    const byHost = new Map<string, GhAccount[]>();
    for (const account of list) {
      const arr = byHost.get(account.host) ?? [];
      arr.push(account);
      byHost.set(account.host, arr);
    }
    return [...byHost.entries()].sort(([a], [b]) => {
      if (a === b) return 0;
      if (a === "github.com") return -1;
      if (b === "github.com") return 1;
      return a.localeCompare(b);
    });
  }, [list]);
  const multiHost = groups.length > 1;

  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-sm font-medium">{t("settings.gitHub")}</h2>
        <p className="text-xs text-muted-foreground">
          {t("accountSettings.githubDescription")}
        </p>
      </div>

      {accounts.isPending ? (
        <Skeleton className="h-16 w-full" />
      ) : version === "" ? (
        <p className="text-xs text-muted-foreground">
          {t("accountSettings.githubCliMissing")}
        </p>
      ) : (
        <>
          {list.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              {t("accountSettings.noGithubAccount")}
            </p>
          ) : (
            <div className="max-w-xl space-y-4">
              {groups.map(([host, hostAccounts]) => (
                <div key={host} className="space-y-1.5">
                  {multiHost && (
                    <p className="text-xs font-medium text-muted-foreground">
                      {host}
                    </p>
                  )}
                  <div className="space-y-px border">
                    {hostAccounts.map((account) => {
                      const rowHealth = healthByKey.get(
                        `${account.host}/${account.login}`,
                      );
                      const broken = rowHealth?.state === "broken";
                      const brokenDetail = rowHealth?.detail;
                      return (
                        <div
                          key={`${account.host}/${account.login}`}
                          className="flex items-center gap-2 border-b px-3 py-2 last:border-b-0"
                        >
                          <span className="text-xs font-medium">
                            {account.login}
                          </span>
                          {account.active && (
                            <Badge variant="secondary">{t("accountSettings.active")}</Badge>
                          )}
                          {broken && (
                            <StatusDetailChip
                              variant="destructive"
                              label={t("accountSettings.sessionExpired")}
                              detail={
                                brokenDetail ??
                                (account.active
                                  ? undefined
                                  : t("accountSettings.switchThenReconnect"))
                              }
                            />
                          )}
                          {rowHealth?.state === "rateLimited" && (
                            <StatusDetailChip
                              variant="outline"
                              className="text-warning"
                              label={t("accountSettings.rateLimited")}
                              detail={rateLimitDetail(rowHealth, now, t)}
                            />
                          )}
                          <span className="flex-1" />
                          {broken && account.active && (
                            <Button
                              variant="outline"
                              size="xs"
                              onClick={() =>
                                openReconnect({
                                  provider: "github",
                                  host: account.host,
                                  mode: "refresh",
                                })
                              }
                            >
                              {t("accountSettings.reconnect")}
                            </Button>
                          )}
                          {!account.active && (
                            <DisabledReasonButton
                              variant="outline"
                              size="xs"
                              disabled={!canSwitch || switchAccount.isPending}
                              // Only the CLI-version term is a reason; an
                              // in-flight switch would announce it falsely.
                              reason={
                                canSwitch
                                  ? undefined
                                  : t("accountSettings.ghVersionRequired")
                              }
                              title={t("accountSettings.makeActiveAccount", { login: account.login, host: account.host })}
                              onClick={() =>
                                switchAccount.mutate(
                                  { host: account.host, login: account.login },
                                  {
                                    onSuccess: () =>
                                      toast.success(
                                        t("accountSettings.switchedTo", { login: account.login }),
                                      ),
                                    onError: (e) => toastError(e),
                                  },
                                )
                              }
                            >
                              {switchAccount.isPending && (
                                <Spinner data-icon="inline-start" />
                              )}
                              {t("accountSettings.switch")}
                            </DisabledReasonButton>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}

          {!canSwitch && (
            <p className="text-xs text-warning">
              {t("accountSettings.multipleAccountsNeedCli", { version })}{" "}
              <button
                type="button"
                className="font-mono underline underline-offset-2"
                onClick={() =>
                  copyText("winget upgrade GitHub.cli", t("accountSettings.commandCopied"))
                }
                title={t("accountSettings.copyCommand")}
              >
                winget upgrade GitHub.cli
              </button>
              {t("accountSettings.thenRestart")}
            </p>
          )}

          <div className="space-y-2">
            <p className="text-xs font-medium">{t("settings.addAccount")}</p>
            <Button
              size="sm"
              className="cursor-pointer"
              onClick={() =>
                openReconnect({
                  provider: "github",
                  host: "github.com",
                  mode: "login",
                })
              }
            >
              {t("accountSettings.signInGithub")}
            </Button>
            <p className="text-xs text-muted-foreground">
              {t("accountSettings.enterpriseLoginPrefix")}{" "}
              <button
                type="button"
                className="font-mono underline underline-offset-2"
                onClick={() =>
                  copyText("gh auth login -h <host>", t("accountSettings.commandCopied"))
                }
                title={t("accountSettings.copyCommand")}
              >
                gh auth login -h &lt;host&gt;
              </button>{" "}
              {t("accountSettings.enterpriseLoginSuffix")}
            </p>
          </div>
        </>
      )}
    </section>
  );
}

/**
 * The GitLab day-to-day sign-in block (distinct from the review-bot token below):
 * the `glab` accounts known to the CLI, with a "session expired" badge + Reconnect
 * on a broken one, a "rate limited" badge (no Reconnect) on a rate-limited one,
 * and a warning before a knowable PAT expiry. OAuth sessions
 * renew themselves, so they carry no expiry chip. Sourced from the accounts-health
 * probe. cliMissing → an install affordance; no signed-in host → a sign-in button.
 */
function GitLabSignInBlock() {
  const { t } = useTranslation();
  const health = useAccountsHealth();
  const openReconnect = useUiStore((s) => s.openReconnect);
  const now = useRelativeNow();

  const gitlab = (health.data ?? []).filter((h) => h.provider === "gitlab");
  const cliMissing = gitlab.some((h) => h.state === "cliMissing");
  // Signed-in hosts = the entries that name a real host (a cliMissing/notConnected
  // sentinel carries none we should list as an account).
  const hosts = gitlab.filter(
    (h) => h.state !== "cliMissing" && h.state !== "notConnected",
  );

  if (health.isPending) return <Skeleton className="h-16 w-full" />;

  return (
    <div className="max-w-xl space-y-3">
      {cliMissing ? (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">
            {t("accountSettings.gitlabCliMissing")}
          </p>
          <Button
            variant="outline"
            size="sm"
            className="cursor-pointer"
            onClick={() => openUrl(GLAB_INSTALL_URL)}
          >
            {t("accountSettings.installGitlabCli")}
          </Button>
        </div>
      ) : hosts.length === 0 ? (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">
            {t("accountSettings.noGitlabHost")}
          </p>
          <Button
            size="sm"
            className="cursor-pointer"
            onClick={() =>
              openReconnect({
                provider: "gitlab",
                host: "gitlab.com",
                mode: "login",
              })
            }
          >
            {t("accountSettings.signInGitlab")}
          </Button>
        </div>
      ) : (
        <div className="space-y-px border">
          {hosts.map((h) => {
            const broken = h.state === "broken";
            const warnExpiry =
              h.state === "healthy" &&
              h.method === "pat" &&
              h.daysLeft != null &&
              h.daysLeft <= 14;
            return (
              <div
                key={`${h.host}/${h.login ?? ""}`}
                className="flex items-center gap-2 border-b px-3 py-2 last:border-b-0"
              >
                <div className="min-w-0">
                  <p className="truncate text-xs font-medium">
                    {h.login ?? h.host}
                  </p>
                  <p className="truncate font-mono text-[11px] text-muted-foreground">
                    {h.host}
                  </p>
                </div>
                {broken && (
                  <StatusDetailChip
                    variant="destructive"
                    className="ml-auto shrink-0"
                    label={t("accountSettings.sessionExpired")}
                    detail={h.detail}
                  />
                )}
                {h.state === "rateLimited" && (
                  <StatusDetailChip
                    variant="outline"
                    className="ml-auto shrink-0 text-warning"
                    label={t("accountSettings.rateLimited")}
                    detail={rateLimitDetail(h, now, t)}
                  />
                )}
                {warnExpiry && (
                  <StatusDetailChip
                    variant="outline"
                    className="ml-auto shrink-0 text-warning"
                    label={
                      (h.daysLeft ?? 0) < 0
                        ? t("accountSettings.tokenExpired")
                        : h.daysLeft === 0
                          ? t("accountSettings.tokenExpiresToday")
                          : t("accountSettings.tokenExpiresIn", { count: h.daysLeft ?? 0 })
                    }
                    detail={h.detail}
                  />
                )}
                {broken && (
                  <Button
                    variant="outline"
                    size="xs"
                    className="shrink-0"
                    onClick={() =>
                      openReconnect({
                        provider: "gitlab",
                        host: h.host,
                        mode: "refresh",
                      })
                    }
                  >
                    {t("accountSettings.reconnect")}
                  </Button>
                )}
              </div>
            );
          })}
        </div>
      )}

      <p className="text-xs text-muted-foreground">{t("accountSettings.gitlabOAuthNudge")}</p>
    </div>
  );
}

/**
 * The GitLab review-bot token — a project or group access token so AI reviews
 * post as that project's bot user instead of the signed-in `glab` account.
 * Immediate-apply like the AI-provider keys (the token isn't part of the
 * settings draft): connecting validates the token against GitLab, saves it to
 * the OS keychain, and returns the bot login the status line then reflects. The
 * token itself never leaves the backend — it's never rendered or logged, and the
 * input clears on success.
 */
function GitLabAccount() {
  const { t } = useTranslation();
  const status = useGitlabReviewBotStatus();
  const setToken = useSetGitlabReviewToken();
  const clearToken = useClearGitlabReviewToken();
  const [confirmClear, setConfirmClear] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const botLogin = status.data ?? null;

  const form = useAppForm({
    defaultValues: { token: "" },
    onSubmit: async ({ value }) => {
      setError(null);
      try {
        const login = await setToken.mutateAsync(value.token.trim());
        form.reset({ token: "" });
        toast.success(t("accountSettings.gitlabReviewsAs", { login }));
      } catch (e) {
        setError(errorMessage(e));
      }
    },
  });

  const token = useSelector(form.store, (s) => s.values.token);
  const canSubmit = token.trim().length > 0;

  async function disconnect() {
    try {
      await clearToken.mutateAsync();
      setConfirmClear(false);
      form.reset({ token: "" });
      toast.success(t("accountSettings.gitlabBotDisconnected"));
    } catch (e) {
      toastError(e);
    }
  }

  return (
    <section className="space-y-4 border-t pt-6">
      <div>
        <h2 className="text-sm font-medium">{t("settings.gitLab")}</h2>
        <p className="text-xs text-muted-foreground">
          {t("accountSettings.gitlabDescription")}
        </p>
      </div>

      <GitLabSignInBlock />
      <GitLabTokenAccount />

      <div className="space-y-2">
        <p className="text-xs font-medium">{t("settings.aiReviewBot")}</p>
        <p className="text-xs text-muted-foreground">
          {t("accountSettings.gitlabBotDescription")}
        </p>
      </div>

      {status.isPending ? (
        <Skeleton className="h-16 w-full" />
      ) : (
        <div className="max-w-xl space-y-4">
          {botLogin ? (
            <div className="space-y-3 border">
              <div className="flex items-center gap-2 border-b px-3 py-2">
                <p className="min-w-0 truncate text-xs">
                  {t("accountSettings.aiReviewsPostAs")}{" "}
                  <span className="font-medium">@{botLogin}</span>
                </p>
                <Badge variant="secondary" className="ml-auto shrink-0">
                  {t("accountSettings.connected")}
                </Badge>
              </div>
              <div className="flex items-center gap-2 px-3 pb-3">
                <Button
                  variant="destructive"
                  size="xs"
                  onClick={() => setConfirmClear(true)}
                >
                  {t("accountSettings.disconnect")}
                </Button>
              </div>
            </div>
          ) : (
            <form
              className="space-y-3"
              onSubmit={(e) => {
                e.preventDefault();
                form.handleSubmit();
              }}
            >
              <form.AppField name="token">
                {(field) => (
                  <field.TextField
                    type="password"
                    label={t("settings.projectAccessToken")}
                    placeholder={t("settings.pasteProjectToken")}
                  />
                )}
              </form.AppField>

              <div className="flex items-center gap-2">
                <DisabledReasonButton
                  type="submit"
                  size="sm"
                  disabled={!canSubmit || setToken.isPending}
                  // No `reason`: the same text renders as the visible warning
                  // beside the button, so announcing it would double up.
                  title={
                    canSubmit
                      ? undefined
                      : t("accountSettings.pasteGitlabToken")
                  }
                >
                  {setToken.isPending && <Spinner data-icon="inline-start" />}
                  {t("accountSettings.connect")}
                </DisabledReasonButton>
                {!canSubmit && (
                  <span className="text-xs text-warning">
                    {t("accountSettings.pasteGitlabToken")}
                  </span>
                )}
              </div>

              {error && <p className="text-xs text-destructive">{error}</p>}
            </form>
          )}

          <div className="space-y-1.5 text-xs text-muted-foreground">
            <p>
              {t("accountSettings.gitlabTokenRequirements")}
            </p>
            <button
              type="button"
              className="cursor-pointer underline underline-offset-2"
              onClick={() => openUrl(GITLAB_PROJECT_TOKEN_URL)}
              title={t("accountSettings.openGitlabTokenDocs")}
            >
              {t("accountSettings.createTokenOnGitlab")}
            </button>
          </div>
        </div>
      )}

      <Dialog open={confirmClear} onOpenChange={setConfirmClear}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("settings.disconnectReviewBot")}</DialogTitle>
            <DialogDescription>
              {t("accountSettings.disconnectGitlabBotDescription")}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmClear(false)}>
              {t("common.cancel")}
            </Button>
            <Button variant="destructive" onClick={disconnect}>
              {t("accountSettings.disconnect")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}

/**
 * A Bitbucket Cloud account, connected with an Atlassian API token. Immediate-
 * apply like the AI-provider keys (the token isn't part of the settings draft):
 * connecting validates the token against Bitbucket, saves it to the OS keychain,
 * and flips open Bitbucket repos ready without a restart.
 */
function BitbucketAccount() {
  const { t } = useTranslation();
  const account = useBbAccount();
  const settings = useSettings();
  const queryClient = useQueryClient();
  const [replacing, setReplacing] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const connected = account.data ?? null;
  const storedExpiry = settings.data?.bitbucketTokenExpiresAt ?? null;
  const expiryDaysLeft = calendarDaysUntil(storedExpiry);

  // The set/clear both invalidate the account query AND every repo's forge-status
  // so a connected Bitbucket repo lights up (or goes dark) without a restart. The
  // settings key too, so the stored token-expiry date reflects immediately. And
  // the work inbox: its sources probe is what gates the Bitbucket leg, on a
  // 5-minute window, so without it a just-connected account reads as absent (and
  // a disconnected one keeps fetching against a missing token) until that lapses.
  function invalidateAll() {
    queryClient.invalidateQueries({ queryKey: ["forge-accounts"] });
    queryClient.invalidateQueries({ queryKey: ["bb-account"] });
    queryClient.invalidateQueries({ queryKey: ["settings"] });
    queryClient.invalidateQueries({
      predicate: (q) =>
        q.queryKey[0] === "repo" && q.queryKey[2] === "forge-status",
    });
    queryClient.invalidateQueries({ queryKey: MY_WORK_SOURCES_KEY });
    queryClient.invalidateQueries({ queryKey: myWorkPageKey("bitbucket") });
  }

  const form = useAppForm({
    // `expiresAt` is optional — connect works without it. Seeded from the stored
    // value so "Replace token…" pre-fills the current expiry.
    defaultValues: {
      email: connected?.email ?? "",
      token: "",
      expiresAt: storedExpiry ?? "",
    },
    onSubmit: async ({ value }) => {
      setError(null);
      try {
        const info = await forgeBbSetAccount(
          value.email.trim(),
          value.token.trim(),
        );
        // Persist the optional expiry on the serialized settings chain (empty =
        // clear). Ride it so a concurrent recent-repo write can't clobber it.
        await setBitbucketTokenExpiresAt(value.expiresAt.trim() || null);
        form.reset({
          email: info.email,
          token: "",
          expiresAt: value.expiresAt,
        });
        setReplacing(false);
        invalidateAll();
        toast.success(
          `Connected to Bitbucket as ${info.username ?? info.email}`,
        );
      } catch (e) {
        setError(errorMessage(e));
      }
    },
  });

  const email = useSelector(form.store, (s) => s.values.email);
  const token = useSelector(form.store, (s) => s.values.token);
  const canSubmit = email.trim().length > 0 && token.trim().length > 0;
  const disabledReason =
    email.trim().length === 0
      ? t("accountSettings.enterAtlassianEmail")
      : token.trim().length === 0
        ? t("accountSettings.pasteAtlassianToken")
        : null;

  async function clearAccount() {
    try {
      await forgeBbClearAccount();
      // The stored expiry can't outlive the token it described.
      await setBitbucketTokenExpiresAt(null);
      setConfirmClear(false);
      setReplacing(false);
      form.reset({ email: "", token: "", expiresAt: "" });
      invalidateAll();
      toast.success(t("accountSettings.bitbucketDisconnected"));
    } catch (e) {
      toastError(e);
    }
  }

  const showForm = !connected || replacing;

  return (
    <section className="space-y-4 border-t pt-6">
      <div>
        <h2 className="text-sm font-medium">{t("settings.bitbucket")}</h2>
        <p className="text-xs text-muted-foreground">
          {t("accountSettings.bitbucketDescription")}
        </p>
      </div>

      {account.isPending ? (
        <Skeleton className="h-16 w-full" />
      ) : (
        <div className="max-w-xl space-y-4">
          {connected && !replacing && (
            <div className="space-y-3 border">
              <div className="flex items-center gap-2 border-b px-3 py-2">
                <div className="min-w-0">
                  <p
                    className="truncate text-xs font-medium"
                    title={connected.username ?? connected.email}
                  >
                    {connected.displayName ??
                      connected.username ??
                      connected.email}
                  </p>
                  <p
                    className="truncate text-[11px] text-muted-foreground"
                    title={connected.email}
                  >
                    {connected.username ? `${connected.username} · ` : ""}
                    {connected.email}
                  </p>
                </div>
                <Badge variant="secondary" className="ml-auto shrink-0">
                  {t("accountSettings.connected")}
                </Badge>
              </div>
              {storedExpiry && (
                <p
                  className={`px-3 text-[11px] ${
                    expiryDaysLeft != null && expiryDaysLeft <= 14
                      ? "text-warning"
                      : "text-muted-foreground"
                  }`}
                >
                  {expiryDaysLeft != null && expiryDaysLeft <= 14
                    ? `${
                        expiryDaysLeft < 0
                          ? t("accountSettings.tokenExpired")
                          : expiryDaysLeft === 0
                            ? t("accountSettings.tokenExpiresToday")
                            : t("accountSettings.tokenExpiresInDays", { count: expiryDaysLeft })
                      } — ${t("accountSettings.replaceTokenSoon")}`
                    : t("accountSettings.tokenExpiresOn", { date: formatDate(storedExpiry) })}
                </p>
              )}
              <div className="flex items-center gap-2 px-3 pb-3">
                <Button
                  variant="outline"
                  size="xs"
                  onClick={() => {
                    setError(null);
                    form.reset({
                      email: connected.email,
                      token: "",
                      expiresAt: storedExpiry ?? "",
                    });
                    setReplacing(true);
                  }}
                >
                  {t("accountSettings.addAnotherAccount")}
                </Button>
                <Button
                  variant="destructive"
                  size="xs"
                  onClick={() => setConfirmClear(true)}
                >
                  {t("accountSettings.disconnect")}
                </Button>
              </div>
            </div>
          )}

          {showForm && (
            <form
              className="space-y-3"
              onSubmit={(e) => {
                e.preventDefault();
                form.handleSubmit();
              }}
            >
              <form.AppField name="email">
                {(field) => (
                  <field.TextField
                    type="email"
                    label={t("settings.atlassianEmail")}
                    placeholder="you@example.com"
                  />
                )}
              </form.AppField>
              <form.AppField name="token">
                {(field) => (
                  <field.TextField
                    type="password"
                    label={t("settings.apiToken")}
                    placeholder={t("settings.pasteApiToken")}
                  />
                )}
              </form.AppField>
              {/* Optional — connect works without it (Bitbucket never reports the
                  expiry, so it's user-supplied to power the pre-expiry warning). */}
              <div className="space-y-1.5">
                <form.AppField name="expiresAt">
                  {(field) => (
                    <field.TextField type="date" label={t("settings.tokenExpiry")} />
                  )}
                </form.AppField>
                <p className="text-[11px] text-muted-foreground">
                  {t("accountSettings.tokenExpiryHelp")}
                </p>
              </div>

              <div className="flex items-center gap-2">
                <DisabledReasonButton
                  type="submit"
                  size="sm"
                  disabled={!canSubmit}
                  // No `reason`: the same text renders as the visible warning
                  // beside the button, so announcing it would double up.
                  title={disabledReason ?? undefined}
                >
                  {connected ? t("accountSettings.addAnotherAccount") : t("accountSettings.connect")}
                </DisabledReasonButton>
                {replacing && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setReplacing(false);
                      setError(null);
                    }}
                  >
                    {t("common.cancel")}
                  </Button>
                )}
                {disabledReason && (
                  <span className="text-xs text-warning">{disabledReason}</span>
                )}
              </div>

              {error && <p className="text-xs text-destructive">{error}</p>}
            </form>
          )}

          <div className="space-y-1.5 text-xs text-muted-foreground">
            <p>
              {t("accountSettings.createAtlassianTokenAt")}{" "}
              <button
                type="button"
                className="cursor-pointer underline underline-offset-2"
                onClick={() => openUrl(ATLASSIAN_TOKEN_URL)}
                title={t("accountSettings.openAtlassianTokens")}
              >
                id.atlassian.com
              </button>{" "}
              {t("accountSettings.atlassianAccountEmailAndScopes")}
            </p>
            <ul className="flex flex-wrap gap-1">
              {BB_SCOPES.map((scope) => (
                <li
                  key={scope}
                  className="rounded-none border px-1.5 py-0.5 font-mono text-[10px]"
                >
                  {scope}
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      <Dialog open={confirmClear} onOpenChange={setConfirmClear}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("settings.disconnectBitbucket")}</DialogTitle>
            <DialogDescription>
              {t("accountSettings.disconnectBitbucketDescription")}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmClear(false)}>
              {t("common.cancel")}
            </Button>
            <Button variant="destructive" onClick={clearAccount}>
              {t("accountSettings.disconnect")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}

function GitLabTokenAccount() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const form = useAppForm({
    defaultValues: { host: "gitlab.com", token: "" },
    onSubmit: async ({ value }) => {
      setWorking(true);
      setError(null);
      try {
        await forgeGitlabAccountAdd(value.host.trim(), value.token.trim());
        form.reset({ host: value.host.trim(), token: "" });
        await queryClient.invalidateQueries();
        toast.success(t("accountSettings.gitlabAccountAdded"));
      } catch (failure) {
        console.error("GitLab account connection failed:", failure);
        setError(errorMessage(failure));
      } finally {
        setWorking(false);
      }
    },
  });
  const host = useSelector(form.store, (state) => state.values.host);
  const token = useSelector(form.store, (state) => state.values.token);
  return (
    <form className="max-w-xl space-y-3" onSubmit={(event) => { event.preventDefault(); form.handleSubmit(); }}>
      <p className="text-xs font-medium">{t("accountSettings.addGitlabAccount")}</p>
      <form.AppField name="host">
        {(field) => <field.TextField label={t("accountSettings.gitlabHost")} placeholder="gitlab.com" />}
      </form.AppField>
      <form.AppField name="token">
        {(field) => <field.TextField type="password" label={t("settings.apiToken")} placeholder={t("settings.pasteApiToken")} />}
      </form.AppField>
      <Button type="submit" size="sm" disabled={working || !host.trim() || !token.trim()}>
        {working && <Spinner data-icon="inline-start" />}
        {t("accountSettings.connect")}
      </Button>
      {error && <p className="text-xs text-destructive" role="alert">{error}</p>}
    </form>
  );
}

function UnifiedAccounts() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const accounts = useQuery({
    queryKey: ["forge-accounts"], queryFn: forgeAccounts, retry: false,
  });
  const [removing, setRemoving] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const selected = accounts.data?.find((account) => account.id === removing);

  async function select(id: string) {
    setBusy(true);
    try {
      await forgeAccountSelect(id);
      await queryClient.invalidateQueries();
    } catch (error) {
      console.error("Default account selection failed:", error);
      toastError(error);
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!removing) return;
    setBusy(true);
    try {
      await forgeAccountRemove(removing);
      setRemoving(null);
      await queryClient.invalidateQueries();
    } catch (error) {
      console.error("Account removal failed:", error);
      toastError(error);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="space-y-3">
      <h2 className="text-sm font-medium">{t("accountSettings.savedAccounts")}</h2>
      {accounts.isPending ? <Skeleton className="h-16 w-full" /> : accounts.isError ? (
        <p className="text-xs text-destructive" role="alert">{errorMessage(accounts.error)}</p>
      ) : accounts.data.length === 0 ? (
        <p className="text-xs text-muted-foreground">{t("accountSettings.noSavedAccounts")}</p>
      ) : (
        <div className="max-w-xl border">
          {accounts.data.map((account) => (
            <div key={account.id} className="flex items-center gap-2 border-b px-3 py-2 last:border-b-0">
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-medium" title={`${account.login} · ${account.host}`}>
                  {account.login} · {account.host}
                </p>
                <p className="text-[11px] text-muted-foreground">
                  {account.provider} · {account.source === "cli" ? "CLI" : t("accountSettings.managedCredential")}
                </p>
              </div>
              {account.isActive ? (
                <Badge variant="secondary">{t("accountSettings.active")}</Badge>
              ) : (
                <Button variant="outline" size="xs" disabled={busy} onClick={() => select(account.id)}>
                  {t("accountSettings.makeDefault")}
                </Button>
              )}
              <Button variant="ghost" size="xs" disabled={busy} onClick={() => setRemoving(account.id)}>
                {t("accountSettings.removeFromApp")}
              </Button>
            </div>
          ))}
        </div>
      )}
      <Dialog open={removing !== null} onOpenChange={(open) => !open && setRemoving(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("accountSettings.removeFromApp")}</DialogTitle>
            <DialogDescription>
              {t("accountSettings.removeAccountDescription", { login: selected?.login ?? "" })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRemoving(null)}>{t("common.cancel")}</Button>
            <Button variant="destructive" disabled={busy} onClick={remove}>{t("accountSettings.removeFromApp")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}

/** CNB account and repository browsing; Rust owns token validation and storage. */
function CnbAccount() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const account = useQuery({
    queryKey: ["cnb-account"],
    queryFn: forgeCnbAccount,
    retry: false,
  });
  const connected = account.data ?? null;
  const repos = useQuery({
    queryKey: ["cnb-repos"],
    queryFn: () => forgeListRepos("cnb"),
    enabled: Boolean(connected),
    retry: false,
  });
  const [replacing, setReplacing] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const form = useAppForm({
    defaultValues: { token: "" },
    onSubmit: async ({ value }) => {
      setError(null);
      setWorking(true);
      try {
        const info = await forgeCnbSetAccount(value.token.trim());
        form.reset({ token: "" });
        setReplacing(false);
        await queryClient.invalidateQueries({ queryKey: ["cnb-account"] });
        await queryClient.invalidateQueries({ queryKey: ["forge-accounts"] });
        await queryClient.invalidateQueries({ queryKey: ["cnb-repos"] });
        toast.success(t("accountSettings.cnbConnectedAs", { username: info.username }));
      } catch (e) {
        console.error("CNB account connection failed:", errorMessage(e));
        setError(errorMessage(e));
      } finally {
        setWorking(false);
      }
    },
  });
  const token = useSelector(form.store, (s) => s.values.token);

  async function disconnect() {
    setWorking(true);
    try {
      await forgeCnbClearAccount();
      setConfirmClear(false);
      setReplacing(false);
      form.reset({ token: "" });
      await queryClient.invalidateQueries({ queryKey: ["cnb-account"] });
      await queryClient.invalidateQueries({ queryKey: ["forge-accounts"] });
      await queryClient.invalidateQueries({ queryKey: ["cnb-repos"] });
      toast.success(t("accountSettings.cnbDisconnected"));
    } catch (e) {
      console.error("CNB account disconnection failed:", errorMessage(e));
      setError(errorMessage(e));
    } finally {
      setWorking(false);
    }
  }

  return (
    <section className="space-y-4 border-t pt-6">
      <div>
        <h2 className="text-sm font-medium">CNB</h2>
        <p className="text-xs text-muted-foreground">
          {t("accountSettings.cnbDescription")}
        </p>
      </div>

      {account.isPending ? (
        <Skeleton className="h-16 w-full" />
      ) : (
        <div className="max-w-xl space-y-4">
          {account.isError && (
            <p className="text-xs text-destructive" role="alert">
              {t("accountSettings.cnbAccountUnavailable", {
                reason: errorMessage(account.error),
              })}
            </p>
          )}

          {connected && !replacing && (
            <div className="space-y-3 border">
              <div className="flex items-center gap-2 border-b px-3 py-2">
                <div className="min-w-0">
                  <p className="truncate text-xs font-medium">
                    {connected.nickname ?? connected.username}
                  </p>
                  {connected.nickname && (
                    <p className="truncate text-[11px] text-muted-foreground">
                      {connected.username}
                    </p>
                  )}
                </div>
                <Badge variant="secondary" className="ml-auto shrink-0">
                  {t("accountSettings.connected")}
                </Badge>
              </div>
              <div className="flex items-center gap-2 px-3 pb-3">
                <Button
                  variant="outline"
                  size="xs"
                  onClick={() => {
                    setError(null);
                    form.reset({ token: "" });
                    setReplacing(true);
                  }}
                >
                  {t("accountSettings.addAnotherAccount")}
                </Button>
                <Button
                  variant="destructive"
                  size="xs"
                  onClick={() => setConfirmClear(true)}
                >
                  {t("accountSettings.disconnect")}
                </Button>
              </div>
            </div>
          )}

          {(!connected || replacing) && (
            <form
              className="space-y-3"
              onSubmit={(event) => {
                event.preventDefault();
                form.handleSubmit();
              }}
            >
              <form.AppField name="token">
                {(field) => (
                  <field.TextField
                    type="password"
                    label={t("accountSettings.cnbToken")}
                    placeholder={t("accountSettings.cnbPasteToken")}
                  />
                )}
              </form.AppField>
              <div className="flex items-center gap-2">
                <Button type="submit" size="sm" disabled={!token.trim() || working}>
                  {working && <Spinner data-icon="inline-start" />}
                  {connected
                    ? t("accountSettings.addAnotherAccount")
                    : t("accountSettings.connect")}
                </Button>
                {replacing && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setReplacing(false);
                      setError(null);
                    }}
                  >
                    {t("common.cancel")}
                  </Button>
                )}
              </div>
            </form>
          )}

          {error && <p className="text-xs text-destructive" role="alert">{error}</p>}

          {connected && (
            <div className="space-y-2">
              <p className="text-xs font-medium">
                {t("accountSettings.cnbRepositories")}
              </p>
              {repos.isPending ? (
                <Skeleton className="h-16 w-full" />
              ) : repos.isError ? (
                <p className="text-xs text-destructive" role="alert">
                  {t("accountSettings.cnbReposUnavailable", {
                    reason: errorMessage(repos.error),
                  })}
                </p>
              ) : repos.data.repos.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  {t("accountSettings.cnbNoRepositories")}
                </p>
              ) : (
                <ul className="max-h-64 overflow-y-auto border">
                  {repos.data.repos.map((repo) => (
                    <li key={repo.fullName} className="border-b px-3 py-2 last:border-b-0">
                      <div className="flex items-center gap-2">
                        <span className="min-w-0 truncate text-xs font-medium" title={repo.fullName}>
                          {repo.fullName}
                        </span>
                        {repo.private && (
                          <Badge variant="outline">{t("accountSettings.cnbPrivate")}</Badge>
                        )}
                        {repo.archived && (
                          <Badge variant="outline">{t("accountSettings.cnbArchived")}</Badge>
                        )}
                      </div>
                      {repo.description && (
                        <p className="truncate text-[11px] text-muted-foreground" title={repo.description}>
                          {repo.description}
                        </p>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      )}

      <Dialog open={confirmClear} onOpenChange={setConfirmClear}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("accountSettings.cnbDisconnectTitle")}</DialogTitle>
            <DialogDescription>
              {t("accountSettings.cnbDisconnectDescription")}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmClear(false)}>
              {t("common.cancel")}
            </Button>
            <Button variant="destructive" disabled={working} onClick={disconnect}>
              {t("accountSettings.disconnect")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
