import { CaretRightIcon, CheckIcon, CopyIcon } from "@phosphor-icons/react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo, useState } from "react";
import { toast } from "sonner";
import { DisabledReasonButton } from "@/components/disabled-reason-button";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import { copyText } from "@/lib/clipboard";
import {
  mcpGlobalInstall,
  mcpGlobalRemove,
  mcpGlobalStatus,
  mcpJsonWrite,
  mcpLauncherPath,
  type PathLauncherStatus,
  pathLauncherInstall,
  pathLauncherRemove,
  pathLauncherStatus,
} from "@/lib/git/api";
import { errorMessage } from "@/lib/tauri/invoke";
import { toastError } from "@/lib/toast";
import { useRetained } from "@/lib/use-retained";
import { useTranslation } from "@/lib/i18n";

/** Where a one-click install writes the `gitdesktop` entry: this repo's
 *  `.mcp.json`, or a client's global (all-projects) user config. */
type InstallTarget = "project" | "claude" | "copilot";

/** The replace-confirm prompt per target — each names the config the existing
 *  `gitdesktop` entry would be overwritten in. */
/** The four `--allow-*` permission flags, in ladder order, mapped to their
 *  human tier label. Drives both the installed-tier readout and the drift
 *  comparison — every other arg (`mcp`, `--repo`, its value, unknown flags) is
 *  ignored, so it never counts as a permission or as drift. */
const ALLOW_FLAG_KEYS: Record<string, "remainingUi.mcpTierLocalWrites" | "remainingUi.mcpTierRemoteWrites" | "remainingUi.mcpTierGitWrites" | "remainingUi.mcpTierDestructive"> = {
  "--allow-write": "remainingUi.mcpTierLocalWrites",
  "--allow-remote-write": "remainingUi.mcpTierRemoteWrites",
  "--allow-git-write": "remainingUi.mcpTierGitWrites",
  "--allow-destructive": "remainingUi.mcpTierDestructive",
};

/** The installed entry's permission tier as a readable label ("local + remote writes"), or
 *  "read-only" when no `--allow-*` flags are present. */
function tierLabel(installedFlags: string[], t: ReturnType<typeof useTranslation>["t"]): string {
  const parts = Object.keys(ALLOW_FLAG_KEYS)
    .filter((flag) => installedFlags.includes(flag))
    .map((flag) => t(ALLOW_FLAG_KEYS[flag]));
  return parts.length ? parts.join(" + ") : t("remainingUi.mcpTierReadOnly");
}

/** Bottom-of-section disclosure: the inverse of the rest of this panel. Instead of consuming
 *  MCP servers, expose GitDesktop's own git/forge tools to external clients, which run the
 *  managed `gitdesktop-mcp` launcher as a stdio server. Read-only by default; four opt-in
 *  `--allow-*` tiers escalate from there. Collapsed by default — one-time setup. */
export function GitDesktopAsServer({ repoPath }: { repoPath: string | null }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  // Checkboxes shape the emitted config: Shareable (portable env-var paths a teammate can
  // commit) vs Personal (absolute machine paths), plus the orthogonal write opt-ins below.
  const [shareable, setShareable] = useState(false);
  const [allowWrite, setAllowWrite] = useState(false);
  const [allowRemoteWrite, setAllowRemoteWrite] = useState(false);
  // Two further, ladder-ordered git-write opt-ins: --allow-git-write (recoverable
  // repo mutations) and --allow-destructive (irreversible ones — requires git-write
  // too, so unchecking git-write must also clear destructive).
  const [allowGitWrite, setAllowGitWrite] = useState(false);
  const [allowDestructive, setAllowDestructive] = useState(false);
  // Dirty-tracking for the four tier checkboxes (NOT `shareable`): the checkboxes start
  // false, so without this a flagged global install would show the drift warning +
  // "Reinstall" the instant the disclosure opens — a nag before any intent. Reset on each
  // closed→open transition; `drift` gates on it.
  const [tierTouched, setTierTouched] = useState(false);
  // One install at a time: `busyTarget` is which is running, `confirmTarget` which
  // is awaiting a replace-confirm. "project" = this repo's .mcp.json;
  // "claude"/"copilot" = that client's global (all-projects) user config.
  const [busyTarget, setBusyTarget] = useState<InstallTarget | null>(null);
  const [confirmTarget, setConfirmTarget] = useState<InstallTarget | null>(
    null,
  );
  // Appearance — the copy AND the button's disabled reason — reads the retained
  // target; the open gate and the confirm dispatch stay on live `confirmTarget`.
  const shownTarget = useRetained(confirmTarget);
  // Which global client is mid-removal — parallel to `busyTarget` (which tracks
  // installs) so per-row Install/Reinstall/Remove disable each other.
  const [removingClient, setRemovingClient] = useState<
    "claude" | "copilot" | null
  >(null);
  // The command-line launcher: is `gitdesktop-mcp` on PATH, and did we put it there? Only
  // fetched while the disclosure is open (it reads the registry / $PATH).
  const queryClient = useQueryClient();
  const { data: launcher, isLoading: launcherLoading } = useQuery({
    queryKey: ["path-launcher-status"],
    queryFn: pathLauncherStatus,
    enabled: open,
    // Local reads must not park on react-query's default "online" mode offline;
    // the same holds for every `networkMode` in this file.
    networkMode: "always",
  });
  const [pathBusy, setPathBusy] = useState(false);
  // The command is the managed MCP launcher — an update-safe copy of the app that isn't
  // file-locked by the installed binary. Resolving it CREATES the copy, so only fetch once
  // the disclosure is open; merely mounting Settings must not write it.
  const {
    data: launcherPath,
    isPending: launcherPathPending,
    error: launcherPathError,
  } = useQuery({
    queryKey: ["mcp-launcher-path"],
    queryFn: mcpLauncherPath,
    staleTime: Number.POSITIVE_INFINITY,
    enabled: open,
    networkMode: "always",
  });
  // Per-client global-install state (Claude Code / Copilot): is `gitdesktop` in that client's
  // user config, and does it point at the CURRENT launcher? A read-only probe of the config
  // file (no CLI spawn, no launcher ensure), refetched after every install/remove.
  const { data: globalStatus, isLoading: globalStatusLoading } = useQuery({
    queryKey: ["mcp-global-status"],
    queryFn: mcpGlobalStatus,
    enabled: open,
    networkMode: "always",
  });
  // Actionable message when the launcher can't be prepared (e.g. antivirus
  // quarantine) — surface it, never emit a config against a wrong/absent path.
  const launcherErrorMessage = launcherPathError
    ? errorMessage(launcherPathError)
    : null;
  // No config embedding the absolute launcher path may be emitted until that path resolves —
  // writing a stale/absent path silently keeps locking the old binary. The global installs
  // always embed it, so they gate on this unconditionally.
  const launcherDisabledReason = launcherPathPending
    ? t("remainingUi.mcpServerPreparing")
    : launcherErrorMessage;
  // In SHAREABLE mode `entry.command` is the constant `${GITDESKTOP_BIN:-gitdesktop-mcp}` —
  // independent of the local launcher, so a pending/failed ensure must not block the one path
  // that provably works. Only personal mode embeds the absolute path.
  const entryDisabledReason = shareable ? null : launcherDisabledReason;
  // The replace-confirm re-runs the SAME emit as the button that opened it, so it
  // must share that button's gate: `project` follows the shareable-aware entry
  // gate; the global targets always embed the launcher path.
  const confirmDisabledReason =
    shownTarget === "project" ? entryDisabledReason : launcherDisabledReason;

  // Single source of truth for both Copy and Write — the exact entry that gets
  // merged into .mcp.json under `mcpServers.gitdesktop`.
  const entry = useMemo(() => {
    const args = shareable
      ? ["mcp", "--repo", "${CLAUDE_PROJECT_DIR:-.}"]
      : ["mcp", "--repo", repoPath ?? "<path to your repo>"];
    if (allowWrite) args.push("--allow-write");
    if (allowRemoteWrite) args.push("--allow-remote-write");
    if (allowGitWrite) args.push("--allow-git-write");
    // --allow-destructive requires git-write; state consistency guarantees
    // allowGitWrite is true whenever allowDestructive is, but gate on both so a
    // stray flag can never emit without its prerequisite.
    if (allowGitWrite && allowDestructive) args.push("--allow-destructive");
    return {
      command: shareable ? "${GITDESKTOP_BIN:-gitdesktop-mcp}" : launcherPath,
      args,
    };
  }, [
    shareable,
    allowWrite,
    allowRemoteWrite,
    allowGitWrite,
    allowDestructive,
    repoPath,
    launcherPath,
  ]);

  // Display-only: while the launcher path resolves, `entry.command` is undefined, so show a
  // muted "…" rather than a JSON object with a missing command. Emission is disabled in that
  // state, so the real `entry` — never the placeholder — is what writes.
  const snippet = JSON.stringify(
    {
      mcpServers: {
        gitdesktop: { ...entry, command: entry.command ?? "…" },
      },
    },
    null,
    2,
  );

  // One-line summary of what the emitted config exposes, reflecting both
  // independent write opt-ins (either, both, or neither).
  const writeTiers = [
    allowWrite && t("remainingUi.mcpTierPrTools"),
    allowRemoteWrite && t("remainingUi.mcpTierRemoteForge"),
    allowGitWrite && t("remainingUi.mcpTierGitOps"),
    allowGitWrite &&
      allowDestructive &&
      t("remainingUi.mcpTierDestructiveOps"),
  ].filter(Boolean);
  const modeNote = writeTiers.length
    ? t("remainingUi.mcpReadWriteMode", { tiers: writeTiers.join(" + ") })
    : t("remainingUi.mcpServerReadonly");

  async function copy() {
    await copyText(snippet);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  // The `--allow-*` flags the current selection wants, in ladder order. Single source of
  // truth for both the emitted global entry and the drift comparison, so installed tier and
  // wanted tier can't diverge. Destructive is gated on git-write (see `entry`).
  const wantedAllowFlags = useCallback((): string[] => {
    const flags: string[] = [];
    if (allowWrite) flags.push("--allow-write");
    if (allowRemoteWrite) flags.push("--allow-remote-write");
    if (allowGitWrite) flags.push("--allow-git-write");
    if (allowGitWrite && allowDestructive) flags.push("--allow-destructive");
    return flags;
  }, [allowWrite, allowRemoteWrite, allowGitWrite, allowDestructive]);

  // The entry a GLOBAL (all-projects) install writes: the absolute exe + a DYNAMIC
  // repo so the server follows whatever project the client is in. The repo var is
  // client-specific — Claude Code expands ${CLAUDE_PROJECT_DIR}; Copilot has no
  // equivalent, so it gets "." and relies on the client launching the server from
  // the workspace folder. The write toggles carry over.
  function globalEntry(target: "claude" | "copilot") {
    const args = [
      "mcp",
      "--repo",
      target === "claude" ? "${CLAUDE_PROJECT_DIR:-.}" : ".",
      ...wantedAllowFlags(),
    ];
    return { command: launcherPath, args };
  }

  // `replaced` = an existing entry was overwritten (reinstall/migrate) so the global toast
  // reads honestly instead of "Added". Project (.mcp.json) toasts don't make the distinction.
  function installSuccessToast(target: InstallTarget, replaced: boolean) {
    if (target === "project") {
      toast.success(
        shareable
          ? ".mcp.json written — commit it to share with your team"
          : ".mcp.json written — paths are machine-specific, consider gitignoring it",
      );
      return;
    }
    const client = target === "claude" ? "Claude Code" : "Copilot";
    toast.success(
      replaced
        ? `Updated gitdesktop in ${client} — points at this launcher now (restart the client).`
        : `Added gitdesktop to ${client} — available in all your projects (restart the client).`,
    );
  }

  // Install to a target without clobbering an existing entry; if one exists, ask
  // before replacing. `overwrite` is only ever true on the confirm path.
  async function install(target: InstallTarget, overwrite: boolean) {
    if (busyTarget) return;
    if (target === "project" && !repoPath) return;
    setBusyTarget(target);
    try {
      let result: { written: boolean; existed: boolean };
      if (target === "project") {
        result = await mcpJsonWrite(repoPath as string, entry, overwrite);
      } else {
        const { command, args } = globalEntry(target);
        // A global install embeds the absolute launcher path; nothing safe to write until it
        // resolves. The buttons gate on this too — this is the type-level backstop.
        if (command === undefined) return;
        result = await mcpGlobalInstall(target, command, args, overwrite);
      }
      if (result.existed && !result.written) {
        setConfirmTarget(target);
        return;
      }
      setConfirmTarget(null);
      installSuccessToast(target, result.existed);
      // A global install/reinstall changed a client's user config — refetch the
      // per-client rows so their installed/current state reflects it.
      if (target !== "project") {
        queryClient.invalidateQueries({ queryKey: ["mcp-global-status"] });
      }
    } catch (e) {
      toastError(e);
    } finally {
      setBusyTarget(null);
    }
  }

  // Remove the global `gitdesktop` entry from a client's user config — one-click
  // and reversible (re-installable), so no confirm dialog (matches the launcher
  // section's Remove). Refetches the rows on success.
  async function removeGlobal(client: "claude" | "copilot") {
    if (removingClient || busyTarget) return;
    setRemovingClient(client);
    try {
      await mcpGlobalRemove(client);
      toast.success(
        t("remainingUi.mcpRemovedFromClient", { client: client === "claude" ? "Claude Code" : "Copilot" }),
      );
      queryClient.invalidateQueries({ queryKey: ["mcp-global-status"] });
    } catch (e) {
      toastError(e);
    } finally {
      setRemovingClient(null);
    }
  }

  // One per-client global-install status row (Claude Code / Copilot): label + contextual
  // action, status line underneath. Install/Reinstall embed the absolute launcher path so
  // they gate on `launcherDisabledReason`; Remove must work even when the launcher errored.
  function globalRow(client: "claude" | "copilot") {
    const label = client === "claude" ? "Claude Code" : "Copilot";
    const status = globalStatus?.[client];
    const installing = busyTarget === client;
    const removing = removingClient === client;
    // Any global install/remove (either row) blocks every row's actions, so a
    // second op can't race a config write.
    const anyBusy = busyTarget !== null || removingClient !== null;
    // Until the status query resolves, the row's action label ("Install" vs
    // "Reinstall") isn't yet known, so hold every action rather than show a
    // possibly-wrong one next to the "Checking…" line.
    const rowLoadingReason = globalStatusLoading
      ? t("remainingUi.mcpCheckingInstall")
      : null;
    const busyReason = anyBusy
      ? t("remainingUi.mcpWaitingOperation")
      : null;
    // Remove doesn't embed the launcher path, so it's exempt from that gate.
    const removeReason = rowLoadingReason ?? busyReason;
    // Install/Reinstall embed the absolute launcher path, so they additionally
    // gate on the launcher being ready.
    const installReason =
      rowLoadingReason ?? busyReason ?? launcherDisabledReason;
    // The known `--allow-*` flags actually installed (order-normalized via the
    // ladder map; every other arg is ignored). `args` is null for an older
    // install predating this probe — then we can't read the tier and omit it.
    const installedFlags =
      status?.args != null
        ? Object.keys(ALLOW_FLAG_KEYS).filter((flag) =>
            (status.args as string[]).includes(flag),
          )
        : null;
    // Drift = the installed permission set differs from the selected one. Gated on
    // `tierTouched` so a pristine open never nags. Only meaningful for a current, readable
    // install — the stale-path (!current) warning owns that case and takes precedence.
    const wanted = wantedAllowFlags();
    const drift =
      tierTouched &&
      status?.installed === true &&
      status.current &&
      installedFlags !== null &&
      (installedFlags.length !== wanted.length ||
        !wanted.every((flag) => installedFlags.includes(flag)));
    return (
      <div className="space-y-1">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-medium">{label}</span>
          <div className="flex items-center gap-2">
            {status?.installed && (
              <DisabledReasonButton
                type="button"
                variant="ghost"
                size="sm"
                disabled={removeReason !== null}
                reason={removeReason}
                onClick={() => removeGlobal(client)}
              >
                {removing ? (
                  <>
                    <Spinner className="size-3" /> {t("remainingUi.mcpRemovePending")}
                  </>
                ) : (
                  t("common.remove")
                )}
              </DisabledReasonButton>
            )}
            <DisabledReasonButton
              type="button"
              variant="outline"
              size="sm"
              disabled={installReason !== null}
              reason={installReason}
              onClick={() => install(client, false)}
            >
              {installing ? (
                <>
                  <Spinner className="size-3" />{" "}
                  {status?.installed && (!status.current || drift)
                    ? t("remainingUi.mcpReinstalling")
                    : t("remainingUi.mcpAdding")}
                </>
              ) : status?.installed && (!status.current || drift) ? (
                t("remainingUi.mcpReinstall")
              ) : (
                t("remainingUi.install")
              )}
            </DisabledReasonButton>
          </div>
        </div>
        {globalStatusLoading ? (
          <p className="text-xs text-muted-foreground">{t("remainingUi.mcpChecking")}</p>
        ) : status?.installed ? (
          !status.current ? (
            // Stale-path warning owns the not-current case and takes precedence
            // over any drift readout — never show both.
            <p className="text-xs text-warning">
              {t("remainingUi.mcpInstalledDifferent")}
            </p>
          ) : drift ? (
            <p className="text-xs text-warning">
              {t("remainingUi.mcpInstalledTierDiffers", { tier: tierLabel(installedFlags ?? [], t) })}
            </p>
          ) : (
            <p className="flex items-center gap-1.5 text-xs text-success">
              <CheckIcon className="shrink-0" />
              <span>
                {t("remainingUi.mcpInstalledUsesLauncher", { tier: installedFlags !== null ? ` (${tierLabel(installedFlags, t)})` : "" })}
              </span>
            </p>
          )
        ) : (
          <p className="text-xs text-muted-foreground">
            {t("remainingUi.mcpNotInUserConfig", { client: label })}
          </p>
        )}
      </div>
    );
  }

  // Run an install/remove and fold the authoritative result back into the cache.
  // `note` is a one-shot success line (shown as a toast); the rest is persistent.
  async function runLauncher(action: () => Promise<PathLauncherStatus>) {
    if (pathBusy) return;
    setPathBusy(true);
    try {
      const next = await action();
      queryClient.setQueryData<PathLauncherStatus>(["path-launcher-status"], {
        ...next,
        note: null,
      });
      if (next.note) toast.success(next.note);
    } catch (e) {
      toastError(e);
    } finally {
      setPathBusy(false);
    }
  }

  return (
    <div className="border-t pt-4">
      <button
        type="button"
        onClick={() =>
          setOpen((o) => {
            if (!o) setTierTouched(false);
            return !o;
          })
        }
        aria-expanded={open}
        aria-controls="gd-as-mcp-config"
        className="flex w-full items-start gap-2 rounded text-left outline-none focus-visible:ring-1 focus-visible:ring-ring"
      >
        <CaretRightIcon
          className={`mt-0.5 shrink-0 text-muted-foreground transition-transform ${
            open ? "rotate-90" : ""
          }`}
        />
        <span className="min-w-0">
          <span className="block text-sm font-medium">
            {t("remainingUi.mcpUseAsServer")}
          </span>
          <span className="block text-xs text-muted-foreground">
            {t("remainingUi.mcpUseAsServerDescription")}
          </span>
        </span>
      </button>

      {open && (
        <div id="gd-as-mcp-config" className="mt-3 space-y-2 pl-6">
          {!repoPath && (
            <p className="text-xs text-muted-foreground">
              {t("remainingUi.mcpNoRepoOpen")}{" "}
              <code className="font-mono">&lt;path to your repo&gt;</code>{" "}
              {t("remainingUi.mcpRepoPlaceholderHint")}
            </p>
          )}

          <div className="space-y-1.5">
            <label className="flex cursor-pointer items-center gap-2 text-xs">
              <Checkbox
                checked={shareable}
                onCheckedChange={(c) => setShareable(c === true)}
              />
              {t("remainingUi.mcpShareableEntry")}
            </label>
            <p className="text-xs text-muted-foreground">
              {shareable
                ? t("remainingUi.mcpPortablePaths")
                : t("remainingUi.mcpAbsolutePaths")}
            </p>
          </div>

          <div className="space-y-1.5">
            <label className="flex cursor-pointer items-center gap-2 text-xs">
              <Checkbox
                checked={allowWrite}
                onCheckedChange={(c) => {
                  setAllowWrite(c === true);
                  setTierTouched(true);
                }}
              />
              {t("remainingUi.mcpAllowWriteTools")}
            </label>
            <p className="text-xs text-muted-foreground">
              {allowWrite
                ? t("remainingUi.mcpAllowWriteDescription")
                : t("remainingUi.mcpReadonlyTools")}
            </p>
          </div>

          <div className="space-y-1.5">
            <label className="flex cursor-pointer items-center gap-2 text-xs">
              <Checkbox
                checked={allowRemoteWrite}
                onCheckedChange={(c) => {
                  setAllowRemoteWrite(c === true);
                  setTierTouched(true);
                }}
              />
              {t("remainingUi.mcpAllowRemoteWrite")}
            </label>
            <p className="text-xs text-muted-foreground">
              {allowRemoteWrite
                ? t("remainingUi.mcpRemoteWriteDescription")
                : t("remainingUi.mcpNoRemoteWrites")}
            </p>
          </div>

          <div className="space-y-1.5">
            <label className="flex cursor-pointer items-center gap-2 text-xs">
              <Checkbox
                checked={allowGitWrite}
                onCheckedChange={(c) => {
                  const on = c === true;
                  setAllowGitWrite(on);
                  setTierTouched(true);
                  // Destructive requires git-write; turning git-write off must
                  // drop it too, so no hidden state can emit --allow-destructive.
                  if (!on) setAllowDestructive(false);
                }}
              />
              {t("remainingUi.mcpAllowGitWrites")}
            </label>
            <p className="text-xs text-muted-foreground">
              {allowGitWrite
                ? t("remainingUi.mcpGitWriteDescription")
                : t("remainingUi.mcpGitUnchanged")}
            </p>
          </div>

          <div className="space-y-1.5">
            {/* Destructive requires git-write. A title on a natively-disabled
                control never surfaces, so wrap the row when it's disabled. */}
            <span
              title={allowGitWrite ? undefined : t("remainingUi.mcpRequiresGitWrites")}
            >
              <label className="flex cursor-pointer items-center gap-2 text-xs">
                <Checkbox
                  checked={allowDestructive}
                  disabled={!allowGitWrite}
                  onCheckedChange={(c) => {
                    setAllowDestructive(c === true);
                    setTierTouched(true);
                  }}
                />
                {t("remainingUi.mcpAllowDestructiveWrites")}
              </label>
            </span>
            <p className="text-xs text-muted-foreground">
              {allowDestructive
                ? t("remainingUi.mcpDestructiveDescription")
                : t("remainingUi.mcpDestructiveBlocked")}
            </p>
          </div>

          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] text-muted-foreground">
              {t("remainingUi.mcpPasteConfig")}
            </span>
            <div className="flex items-center gap-2">
              <DisabledReasonButton
                type="button"
                variant="ghost"
                size="sm"
                disabled={entryDisabledReason !== null}
                reason={entryDisabledReason}
                onClick={copy}
              >
                {copied ? (
                  <>
                    <CheckIcon data-icon="inline-start" /> {t("remainingUi.copied")}
                  </>
                ) : (
                  <>
                    <CopyIcon data-icon="inline-start" /> {t("remainingUi.copy")}
                  </>
                )}
              </DisabledReasonButton>
              <DisabledReasonButton
                type="button"
                variant="outline"
                size="sm"
                disabled={
                  !repoPath ||
                  busyTarget !== null ||
                  entryDisabledReason !== null
                }
                reason={
                  entryDisabledReason ??
                  (repoPath
                    ? undefined
                    : t("remainingUi.mcpOpenRepoToWrite"))
                }
                onClick={() => install("project", false)}
              >
                {busyTarget === "project" ? (
                  <>
                    <Spinner className="size-3" /> {t("remainingUi.writing")}
                  </>
                ) : (
                  t("remainingUi.mcpWriteJson")
                )}
              </DisabledReasonButton>
            </div>
          </div>
          {launcherErrorMessage && (
            <p className="text-xs text-warning">{launcherErrorMessage}</p>
          )}
          <pre className="overflow-x-auto rounded border bg-muted/40 p-3 font-mono text-[11px] leading-relaxed">
            {snippet}
          </pre>
          <p className="text-xs text-muted-foreground">{modeNote}</p>
          <p className="text-xs text-muted-foreground">
            {t("remainingUi.mcpOlderConfigNotice")}
          </p>

          {/* Per-client rows into a client's user config (all projects), via its own CLI,
              with a project-aware --repo so one entry follows whatever repo is open. */}
          <div className="mt-1 space-y-2 border-t pt-3">
            <span className="text-xs font-medium">
              {t("remainingUi.mcpInstallGlobally")}
            </span>
            {globalRow("claude")}
            {globalRow("copilot")}
            <p className="text-xs text-muted-foreground">
              {t("remainingUi.mcpGlobalInstallDescription")}
            </p>
          </div>

          {/* Command-line launcher — make `gitdesktop` resolve in any terminal
              so the bare command above works without a hardcoded path. */}
          <div className="mt-1 space-y-1.5 border-t pt-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-medium">{t("remainingUi.mcpCommandLauncher")}</span>
              {launcherLoading ? (
                <span className="text-[11px] text-muted-foreground">
                  {t("remainingUi.mcpCheckingPath")}
                </span>
              ) : launcher?.onPath ? (
                launcher.managed ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={pathBusy}
                    onClick={() => runLauncher(pathLauncherRemove)}
                  >
                    {pathBusy ? (
                      <>
                        <Spinner className="size-3" /> {t("remainingUi.mcpRemovePending")}
                      </>
                    ) : (
                      t("common.remove")
                    )}
                  </Button>
                ) : null
              ) : (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={pathBusy}
                  onClick={() => runLauncher(pathLauncherInstall)}
                >
                  {pathBusy ? (
                    <>
                      <Spinner className="size-3" /> {t("remainingUi.mcpAddingPath")}
                    </>
                  ) : (
                    t("remainingUi.mcpAddPath")
                  )}
                </Button>
              )}
            </div>
            {!launcherLoading &&
              (launcher?.onPath ? (
                <p className="flex items-center gap-1.5 text-xs text-success">
                  <CheckIcon className="shrink-0" />
                  <span>
                    {t("remainingUi.mcpOnPath")}
                    {!launcher.managed && t("remainingUi.mcpAddedOutsideApp")}
                  </span>
                </p>
              ) : (
                <p className="text-xs text-muted-foreground">
                  {t("remainingUi.mcpAddToPathDescription")}
                </p>
              ))}
            {launcher?.warning && (
              <p className="text-xs text-warning">{launcher.warning}</p>
            )}
          </div>

          <Dialog
            open={confirmTarget !== null}
            onOpenChange={(o) => {
              // Don't let Escape/backdrop dismiss mid-replace (the Cancel button
              // is disabled then too), or the install finishes and fires a success
              // toast after the user thought they'd cancelled.
              if (!o && busyTarget === null) setConfirmTarget(null);
            }}
          >
            <DialogContent>
              <DialogHeader>
                <DialogTitle>{t("remainingUi.mcpReplaceEntryTitle")}</DialogTitle>
                <DialogDescription>
                  {shownTarget && t(shownTarget === "project" ? "remainingUi.mcpReplaceProjectPrompt" : shownTarget === "claude" ? "remainingUi.mcpReplaceClaudePrompt" : "remainingUi.mcpReplaceCopilotPrompt")}
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={busyTarget !== null}
                  onClick={() => setConfirmTarget(null)}
                >
                  {t("common.cancel")}
                </Button>
                <DisabledReasonButton
                  type="button"
                  size="sm"
                  disabled={
                    busyTarget !== null || confirmDisabledReason !== null
                  }
                  reason={confirmDisabledReason}
                  onClick={() => confirmTarget && install(confirmTarget, true)}
                >
                  {busyTarget !== null ? (
                    <>
                      <Spinner className="size-3" /> {t("remainingUi.mcpReplacing")}
                    </>
                  ) : (
                    t("remainingUi.mcpReplaceEntry")
                  )}
                </DisabledReasonButton>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      )}
    </div>
  );
}
