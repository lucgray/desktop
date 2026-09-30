import { useQueryClient } from "@tanstack/react-query";
import { openUrl } from "@tauri-apps/plugin-opener";
import { type ComponentProps, type ReactNode, useState } from "react";
import { toast } from "sonner";
import { DisabledReasonButton } from "@/components/disabled-reason-button";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { probeAndPersistVisibility } from "@/features/repository/useRepoVisibilityProbe";
import {
  invalidateRepoAfterWrite,
  useBbRepoSettings,
  useDeleteRepo,
  useForgeStatus,
  useGlRemoveForkRelationship,
  useGlRepoSettings,
  useRemotes,
  useRemoveRemote,
  useRenameRepo,
  useRepoAdmin,
  useRepoSettings,
  useSetArchived,
  useSetVisibility,
  useTransferRepo,
} from "@/lib/git/queries";
import { type ForgeProvider, providerLabel } from "@/lib/git/types";
type SupportedProvider = Exclude<ForgeProvider, "cnb">;
import { clearRepoLensCache } from "@/lib/repo-lens/queries";
import { deleteRepoLens } from "@/lib/repo-lens/store";
import { settingsKeys, useSettings } from "@/lib/settings/queries";
import { useUiStore } from "@/lib/stores/ui";
import { toastError } from "@/lib/toast";
import { useTranslation, type TranslationKey } from "@/lib/i18n";
import { useSeedOnOpen } from "@/lib/use-seed-on-open";
import { InlineConfirm } from "./parts";
import { ScopeRefreshHint } from "./ScopeRefreshHint";

/** The provider-neutral facts the danger actions need, sourced from whichever
 *  provider's settings read is active. */
interface DangerInfo {
  /** "owner/repo" (GitHub) or the full project path (GitLab) — the confirm phrase. */
  fullName: string;
  /** What the rename input starts from (GitHub repo name / GitLab path slug). */
  currentName: string;
  archived: boolean;
  visibility: string;
  /** The repo's web URL — Bitbucket's transfer link-out targets `{webUrl}/admin`. */
  webUrl: string;
}

/** A guarded destructive dialog: the confirm button stays disabled until the
 *  user types the repo's `owner/repo` exactly. */
function DangerDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmPhrase,
  confirmLabel,
  pending,
  disabled,
  onConfirm,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: ReactNode;
  confirmPhrase: string;
  confirmLabel: string;
  pending: boolean;
  disabled?: boolean;
  onConfirm: () => void;
  children?: ReactNode;
}) {
  const { t } = useTranslation();
  const [typed, setTyped] = useState("");
  useSeedOnOpen(open, () => setTyped(""));

  const matches = typed.trim() === confirmPhrase;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        {children}
        <div className="space-y-1.5">
          <Label htmlFor="danger-confirm" className="text-xs">
            {t("dangerZoneUi.typeToConfirm", { phrase: confirmPhrase })}
          </Label>
          <Input
            id="danger-confirm"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            autoComplete="off"
            spellCheck={false}
            className="font-mono"
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          <Button
            variant="destructive"
            disabled={!matches || disabled || pending}
            onClick={onConfirm}
          >
            {pending && <Spinner data-icon="inline-start" />}
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Row({
  title,
  desc,
  children,
}: {
  title: string;
  desc: string;
  children: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="min-w-0">
        <p className="text-xs font-medium">{title}</p>
        <p className="text-[11px] text-muted-foreground">{desc}</p>
      </div>
      {children}
    </div>
  );
}

const OWNER_HINT_KEY = "dangerZoneUi.ownerRequired" as const;

function visibilityKey(value: string): TranslationKey {
  if (value === "public") return "dangerZoneUi.visibility_public";
  if (value === "private") return "dangerZoneUi.visibility_private";
  if (value === "internal") return "dangerZoneUi.visibility_internal";
  return "dangerZoneUi.visibility_unknown";
}

/** A danger-zone trigger whose disabled state still explains itself. `className`
 *  stays the row's layout hook (it lands on the wrapper, as it always has). */
function DangerButton({
  hint,
  className,
  ...props
}: Omit<ComponentProps<typeof Button>, "className"> & {
  hint?: string;
  className?: string;
}) {
  return (
    <DisabledReasonButton
      size="sm"
      reason={hint}
      wrapperClassName={className}
      {...props}
    />
  );
}

function RenameAction({
  repoPath,
  info,
  provider,
}: {
  repoPath: string;
  info: DangerInfo;
  provider: SupportedProvider;
}) {
  const { t } = useTranslation();
  const rename = useRenameRepo(repoPath);
  const current = info.currentName;
  const [name, setName] = useState(current);
  const isGitLab = provider === "gitlab";
  // GitLab paths must start alphanumeric; GitHub/Bitbucket allow a leading
  // `.`/`_`/`-` (".github" is a standard repo name) — the check branches so
  // they keep their fuller grammar.
  const valid = isGitLab
    ? /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name.trim())
    : /^[A-Za-z0-9._-]+$/.test(name.trim());
  const changed = name.trim() !== current;

  // Awaited, not per-call callbacks: react-query drops those when this subtree
  // unmounts mid-flight — closing the dialog or switching the rail's section —
  // so the outcome would never reach the user.
  async function handleRename() {
    try {
      await rename.mutateAsync(name.trim());
      toast.success(t(`dangerZoneUi.renameToast_${provider}`, { name: name.trim() }));
    } catch (e) {
      toastError(e);
    }
  }

  return (
    <Row
      title={isGitLab ? t("dangerZoneUi.renameProject") : t("dangerZoneUi.renameRepository")}
      desc={t(isGitLab ? "dangerZoneUi.renameProjectDescription" : provider === "bitbucket" ? "dangerZoneUi.renameBitbucketDescription" : "dangerZoneUi.renameRepositoryDescription")}
    >
      <div className="flex shrink-0 items-center gap-2">
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="h-8 w-44 font-mono"
          autoComplete="off"
          spellCheck={false}
        />
        <Button
          variant="outline"
          size="sm"
          disabled={!valid || !changed || rename.isPending}
          onClick={handleRename}
        >
          {rename.isPending && <Spinner data-icon="inline-start" />}
          {t("dangerZoneUi.rename")}
        </Button>
      </div>
    </Row>
  );
}

function ArchiveAction({
  repoPath,
  info,
  isGitLab,
  isOwner,
}: {
  repoPath: string;
  info: DangerInfo;
  isGitLab: boolean;
  isOwner: boolean;
}) {
  const { t } = useTranslation();
  const setArchived = useSetArchived(repoPath);
  const [confirming, setConfirming] = useState(false);
  const archived = info.archived;
  // Sentence-cased for toasts, lowercase mid-sentence — GitHub copy unchanged.
  const noun = isGitLab ? t("dangerZoneUi.project") : t("dangerZoneUi.repository");

  async function handleArchive() {
    try {
      await setArchived.mutateAsync(!archived);
      toast.success(t(archived ? "dangerZoneUi.unarchivedToast" : "dangerZoneUi.archivedToast", { noun }));
      setConfirming(false);
    } catch (e) {
      toastError(e);
    }
  }

  return (
    <Row
      title={t(archived ? "dangerZoneUi.unarchiveNoun" : "dangerZoneUi.archiveNoun", { noun })}
      desc={
        archived
          ? t("dangerZoneUi.makeWritable", { noun })
          : t("dangerZoneUi.makeReadOnly", { noun })
      }
    >
      {confirming ? (
        <div className="flex shrink-0 items-center gap-2">
          <InlineConfirm
            actLabel={t(archived ? "dangerZoneUi.unarchive" : "dangerZoneUi.archive")}
            actVariant={archived ? "default" : "destructive"}
            pending={setArchived.isPending}
            onCancel={() => setConfirming(false)}
            onAct={handleArchive}
          />
        </div>
      ) : (
        <DangerButton
          variant="outline"
          disabled={!isOwner}
          hint={isOwner ? undefined : t(OWNER_HINT_KEY)}
          className="shrink-0"
          onClick={() => setConfirming(true)}
        >
          {t(archived ? "dangerZoneUi.unarchive" : "dangerZoneUi.archive")}
        </DangerButton>
      )}
    </Row>
  );
}

/** Local detach: drop the `upstream` remote, collapsing every fork-identity
 *  surface (the origin/upstream switcher, "Update from upstream", "Create on
 *  parent") via the broad `["repo", repo]` invalidation. Reversible — the user
 *  can re-add the remote (CreatePrDialog's Add-upstream affordance returns for a
 *  known fork). Shown for ANY provider whenever an `upstream` remote exists;
 *  never fakes the persisted `isFork` provenance (that reflects GitHub-side
 *  truth and only changes via re-probe). */
function RemoveUpstreamAction({ repoPath }: { repoPath: string }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const remotes = useRemotes(repoPath);
  const removeRemote = useRemoveRemote(repoPath);
  const [confirming, setConfirming] = useState(false);

  async function handleRemoveUpstream() {
    try {
      await removeRemote.mutateAsync({ name: "upstream" });
      // Hygiene: the persisted "upstream" lens no longer applies.
      // Fire-and-forget — the lens read safe-defaults to origin,
      // so a failure here is harmless. The CACHED lens drops with
      // it: its key sits outside the repo subtree this mutation
      // invalidates, so re-adding upstream in the same session
      // would otherwise resurrect the preference just deleted.
      deleteRepoLens(repoPath).catch(() => undefined);
      clearRepoLensCache(queryClient, repoPath);
      // Removing upstream collapses the lens to origin, so a still-
      // selected remote number would resolve against the other repo.
      // Same clears `useSetRepoLens` does on an explicit lens flip.
      const ui = useUiStore.getState();
      if (ui.selectedPr?.kind === "remote") ui.selectPr(null);
      if (ui.selectedIssue?.kind === "remote") ui.selectIssue(null);
      toast.success(t("dangerZoneUi.upstreamRemoved"));
      setConfirming(false);
    } catch (e) {
      toastError(e);
    }
  }

  if (!remotes.data?.includes("upstream")) return null;

  return (
    <>
      <div className="border-t" />
      <Row
        title={t("dangerZoneUi.removeUpstreamTitle")}
        desc={t("dangerZoneUi.removeUpstreamDescription")}
      >
        {confirming ? (
          <div className="flex shrink-0 items-center gap-2">
            <InlineConfirm
              actLabel={t("common.remove")}
              pending={removeRemote.isPending}
              onCancel={() => setConfirming(false)}
              onAct={handleRemoveUpstream}
            />
          </div>
        ) : (
          <DangerButton
            variant="outline"
            className="shrink-0"
            onClick={() => setConfirming(true)}
          >
            {t("dangerZoneUi.removeUpstream")}
          </DangerButton>
        )}
      </Row>
    </>
  );
}

/** Leave the fork network — provider-branched, gated on the persisted fork
 *  provenance (independent of the upstream-remote gate):
 *  - **GitLab** has a real API, so this is an in-app, Owner-gated detach that
 *    removes the fork relationship (open MRs to the parent are closed).
 *  - **GitHub** and **Bitbucket** have no detach API, so they link out to the
 *    provider's settings page (GitHub `…/settings`, Bitbucket `…/admin`).
 *  A shared "Re-check fork status" affordance re-probes and re-persists, so the
 *  fork badge + persisted `isFork` clear once the network is left — never
 *  cleared optimistically (it reflects forge-side truth). Its toasts name the
 *  active provider. The GitLab arm also fires the re-probe itself on success. */
function LeaveForkNetworkAction({
  repoPath,
  fullName,
  provider,
  isOwner,
}: {
  repoPath: string;
  fullName: string;
  provider: SupportedProvider;
  isOwner: boolean;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const settings = useSettings();
  const forge = useForgeStatus(repoPath);
  const removeFork = useGlRemoveForkRelationship(repoPath);
  const [rechecking, setRechecking] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const record = settings.data?.recentRepos.find((r) => r.path === repoPath);

  if (record?.isFork !== true) return null;

  // The provider's own label, for the re-check toasts.
  const label = providerLabel(provider);

  // Derive the host — on GitHub Enterprise the provider is still "github" but a
  // hardcoded github.com would open the wrong host's settings page. While the
  // forge status is still resolving (or errored — retry: false), fall back to
  // the persisted RecentRepo host, which is available synchronously. Bitbucket
  // support is Cloud-only, so its fallback is always bitbucket.org.
  const ghHost = forge.data?.host || record?.host || "github.com";
  const bbHost = record?.host || "bitbucket.org";

  // Post-success confirmation probe (GitLab in-app detach). A failure is
  // swallowed deliberately: the detach itself already succeeded (and toasted),
  // the persisted badge self-heals on the next repo open, and the row's own
  // "Re-check fork status" button — which does surface errors — remains
  // available meanwhile.
  const reprobe = () =>
    probeAndPersistVisibility(repoPath)
      .then(() =>
        queryClient.invalidateQueries({ queryKey: settingsKeys.settings }),
      )
      .catch(() => undefined);

  const recheck = async () => {
    setRechecking(true);
    try {
      const probe = await probeAndPersistVisibility(repoPath);
      queryClient.invalidateQueries({ queryKey: settingsKeys.settings });
      // A null probe means no provider was detected (e.g. the origin remote is
      // gone) — the badge still clears, but don't present that as a verified
      // detach.
      if (probe === null) {
        toast.success(t("dangerZoneUi.forkNotVerified", { provider: label }));
      } else {
        toast.success(
          probe.isFork
            ? t("dangerZoneUi.stillFork", { provider: label })
            : t("dangerZoneUi.noLongerFork", { provider: label }),
        );
      }
    } catch (e) {
      toastError(e);
    } finally {
      setRechecking(false);
    }
  };

  const handleRemoveFork = async () => {
    try {
      await removeFork.mutateAsync(undefined);
      toast.success(t("dangerZoneUi.forkRelationshipRemoved"));
      setConfirming(false);
      // Re-probe to flip the persisted badge; the row unmounts
      // itself once `isFork` reads false.
      reprobe();
    } catch (e) {
      toastError(e);
    }
  };

  // The provider's own way out of the network: GitLab detaches in-app behind an
  // inline confirm, the others link out to the page that owns the action.
  const forkAction: Record<SupportedProvider, () => ReactNode> = {
    github: () => (
      <Button
        variant="destructive"
        size="sm"
        onClick={() => openUrl(`https://${ghHost}/${fullName}/settings`)}
      >
        {t("dangerZoneUi.leaveOnGitHub")}
      </Button>
    ),
    gitlab: () =>
      confirming ? (
        <InlineConfirm
          actLabel={t("common.remove")}
          pending={removeFork.isPending}
          onCancel={() => setConfirming(false)}
          onAct={handleRemoveFork}
        />
      ) : (
        <DangerButton
          variant="destructive"
          disabled={!isOwner}
          hint={isOwner ? undefined : t(OWNER_HINT_KEY)}
          onClick={() => setConfirming(true)}
        >
          {t("dangerZoneUi.removeForkRelationship")}
        </DangerButton>
      ),
    bitbucket: () => (
      <Button
        variant="destructive"
        size="sm"
        onClick={() => openUrl(`https://${bbHost}/${fullName}/admin`)}
      >
        {t("dangerZoneUi.detachOnBitbucket")}
      </Button>
    ),
  };

  return (
    <>
      <div className="border-t" />
      <Row title={t("dangerZoneUi.leaveForkNetwork")} desc={t(`dangerZoneUi.${provider}ForkDescription`)}>
        {/* Stacked so the description keeps its width — two side-by-side
            buttons squeezed the copy into a tall, narrow column. */}
        <div className="flex shrink-0 flex-col gap-2">
          {forkAction[provider]()}
          <Button
            variant="outline"
            size="sm"
            disabled={rechecking}
            onClick={recheck}
          >
            {rechecking && <Spinner data-icon="inline-start" />}
            {t("dangerZoneUi.recheckForkStatus")}
          </Button>
        </div>
      </Row>
    </>
  );
}

const VISIBILITIES = ["public", "private", "internal"];
// Bitbucket only knows public/private — no "internal".
const BB_VISIBILITIES = ["public", "private"];

function VisibilityAction({
  repoPath,
  info,
  provider,
  isOwner,
}: {
  repoPath: string;
  info: DangerInfo;
  provider: SupportedProvider;
  isOwner: boolean;
}) {
  const { t } = useTranslation();
  const setVisibility = useSetVisibility(repoPath);
  const [open, setOpen] = useState(false);
  const [target, setTarget] = useState(info.visibility || "public");
  const isGitLab = provider === "gitlab";
  const isBitbucket = provider === "bitbucket";
  const visibilities = isBitbucket ? BB_VISIBILITIES : VISIBILITIES;

  async function handleChangeVisibility() {
    try {
      await setVisibility.mutateAsync(target);
      toast.success(t(`dangerZoneUi.visibilityToast_${provider}`, { visibility: t(visibilityKey(target)) }));
      setOpen(false);
    } catch (e) {
      toastError(e);
    }
  }

  return (
    <Row
      title={isGitLab ? t("dangerZoneUi.changeProjectVisibility") : t("dangerZoneUi.changeRepositoryVisibility")}
      desc={t("dangerZoneUi.currentVisibility", { visibility: t(visibilityKey(info.visibility || "unknown")) })}
    >
      <DangerButton
        variant="outline"
        disabled={!isOwner}
        hint={isOwner ? undefined : t(OWNER_HINT_KEY)}
        onClick={() => {
          setTarget(info.visibility || "public");
          setOpen(true);
        }}
      >
        {t("dangerZoneUi.changeVisibility")}
      </DangerButton>
      <DangerDialog
        open={open}
        onOpenChange={setOpen}
        title={t("dangerZoneUi.changeVisibility")}
        description={t(`dangerZoneUi.visibilityDescription_${provider}`)}
        confirmPhrase={info.fullName}
        confirmLabel={t("dangerZoneUi.changeVisibility")}
        disabled={target === info.visibility}
        pending={setVisibility.isPending}
        onConfirm={handleChangeVisibility}
      >
        <div className="space-y-1.5">
          <Label htmlFor="visibility-target" className="text-xs">
            {t("dangerZoneUi.newVisibility")}
          </Label>
          <Select value={target} onValueChange={(v) => v && setTarget(v)}>
            <SelectTrigger id="visibility-target" className="w-40">
              <SelectValue className="capitalize" />
            </SelectTrigger>
            <SelectContent>
              {visibilities.map((v) => (
                <SelectItem key={v} value={v} className="capitalize">
                  {t(visibilityKey(v))}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {!isBitbucket && (
            <p className="text-[11px] text-muted-foreground">
              {t(`dangerZoneUi.internalVisibilityNote_${provider}`)}
            </p>
          )}
        </div>
      </DangerDialog>
    </Row>
  );
}

function TransferAction({
  repoPath,
  info,
  provider,
  isOwner,
}: {
  repoPath: string;
  info: DangerInfo;
  provider: SupportedProvider;
  isOwner: boolean;
}) {
  const { t } = useTranslation();
  const transfer = useTransferRepo(repoPath);
  const [open, setOpen] = useState(false);
  const [newOwner, setNewOwner] = useState("");

  async function handleTransfer() {
    try {
      await transfer.mutateAsync({ newOwner: newOwner.trim(), newName: null });
      toast.success(t(`dangerZoneUi.transferToast_${provider}`));
      setOpen(false);
    } catch (e) {
      toastError(e);
    }
  }

  // Bitbucket's REST API can't transfer a repo — send the user to the web
  // admin page instead of offering a form that would only error.
  if (provider === "bitbucket") {
    return (
      <Row
        title={t("dangerZoneUi.transferOwnership")}
        desc={t("dangerZoneUi.bitbucketTransferWeb")}
      >
        <DangerButton
          variant="outline"
          disabled={!isOwner || !info.webUrl}
          hint={isOwner ? undefined : t(OWNER_HINT_KEY)}
          onClick={() => info.webUrl && openUrl(`${info.webUrl}/admin`)}
        >
          {t("dangerZoneUi.transferOnBitbucket")}
        </DangerButton>
      </Row>
    );
  }

  return (
    <Row title={t("dangerZoneUi.transferOwnership")} desc={t(`dangerZoneUi.transferDescription_${provider}`)}>
      <DangerButton
        variant="outline"
        disabled={!isOwner}
        hint={isOwner ? undefined : t(OWNER_HINT_KEY)}
        onClick={() => setOpen(true)}
      >
        {t("dangerZoneUi.transfer")}
      </DangerButton>
      <DangerDialog
        open={open}
        onOpenChange={setOpen}
        title={t(provider === "gitlab" ? "dangerZoneUi.transferProject" : "dangerZoneUi.transferRepository")}
        description={t(`dangerZoneUi.transferDialogDescription_${provider}`)}
        confirmPhrase={info.fullName}
        confirmLabel={t("dangerZoneUi.transfer")}
        disabled={!newOwner.trim()}
        pending={transfer.isPending}
        onConfirm={handleTransfer}
      >
        <div className="space-y-1.5">
          <Label htmlFor="transfer-owner" className="text-xs">
            {t(provider === "gitlab" ? "dangerZoneUi.newNamespace" : "dangerZoneUi.newOwner")}
          </Label>
          <Input
            id="transfer-owner"
            value={newOwner}
            onChange={(e) => setNewOwner(e.target.value)}
            placeholder={provider === "gitlab" ? "group/subgroup or username" : "username-or-org"}
            autoComplete="off"
            spellCheck={false}
          />
        </div>
      </DangerDialog>
    </Row>
  );
}

function DeleteAction({
  repoPath,
  info,
  provider,
  isOwner,
  onRepoDeleted,
}: {
  repoPath: string;
  info: DangerInfo;
  provider: SupportedProvider;
  isOwner: boolean;
  onRepoDeleted: () => void;
}) {
  const { t } = useTranslation();
  const del = useDeleteRepo(repoPath);
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const isGitLab = provider === "gitlab";
  const isBitbucket = provider === "bitbucket";
  const noun = isGitLab ? t("dangerZoneUi.project") : t("dangerZoneUi.repository");

  async function handleDelete() {
    try {
      await del.mutateAsync(undefined);
      toast.success(t(`dangerZoneUi.deleteToast_${provider}`));
      setOpen(false);
      // The remote is gone — re-probe the repo's hosted panels so they
      // stop showing stale data, and close the settings dialog (it only
      // offers actions against a repo that no longer exists).
      void invalidateRepoAfterWrite(queryClient, repoPath);
      onRepoDeleted();
    } catch (e) {
      toastError(e);
    }
  }

  return (
    <Row
      title={t("dangerZoneUi.deleteThis", { noun })}
      desc={t("dangerZoneUi.deleteDescription", { noun, provider: providerLabel(provider) })}
    >
      <DangerButton
        variant="destructive"
        disabled={!isOwner}
        hint={isOwner ? undefined : t(OWNER_HINT_KEY)}
        onClick={() => setOpen(true)}
      >
        {t("common.delete")}
      </DangerButton>
      <DangerDialog
        open={open}
        onOpenChange={setOpen}
        title={t("dangerZoneUi.deleteNoun", { noun })}
        description={t(`dangerZoneUi.deleteDialogDescription_${provider}`)}
        confirmPhrase={info.fullName}
        confirmLabel={t("dangerZoneUi.deleteForever")}
        pending={del.isPending}
        onConfirm={handleDelete}
      >
        {!isGitLab && !isBitbucket && (
          <ScopeRefreshHint
            scope="delete_repo"
            action={t("dangerZoneUi.deletingRepository")}
          />
        )}
      </DangerDialog>
    </Row>
  );
}

/** Destructive lifecycle actions, at the bottom of the settings rail. Works for
 *  both providers: the mutations dispatch behind the abstraction, and GitLab's
 *  Owner-only actions (archive / visibility / transfer / delete) disable with
 *  an explanation for Maintainers. */
export function DangerZone({
  repoPath,
  open,
  provider,
  onRepoDeleted,
}: {
  repoPath: string;
  open: boolean;
  provider: SupportedProvider;
  /** Called after the remote repo is deleted — the dialog closes itself. */
  onRepoDeleted: () => void;
}) {
  const { t } = useTranslation();
  const isGitLab = provider === "gitlab";
  const isBitbucket = provider === "bitbucket";
  const isGitHub = !isGitLab && !isBitbucket;
  const gh = useRepoSettings(repoPath, open && isGitHub);
  const gl = useGlRepoSettings(repoPath, open && isGitLab);
  const bb = useBbRepoSettings(repoPath, open && isBitbucket);
  // Owner gating (GitLab / Bitbucket): the same probe the menu item used, so
  // it's cached. GitHub admin implies owner, so it doesn't need the probe.
  const admin = useRepoAdmin(repoPath, open && (isGitLab || isBitbucket));

  // Each provider's settings read, normalized to the neutral shape; null until
  // the active provider's query has data.
  const infoFor: Record<SupportedProvider, () => DangerInfo | null> = {
    github: () =>
      gh.data
        ? {
            fullName: gh.data.fullName,
            currentName: gh.data.fullName.split("/").pop() ?? "",
            archived: gh.data.archived,
            visibility: gh.data.visibility,
            webUrl: "",
          }
        : null,
    gitlab: () =>
      gl.data
        ? {
            fullName: gl.data.fullName,
            currentName: gl.data.path,
            archived: gl.data.archived,
            visibility: gl.data.visibility,
            webUrl: "",
          }
        : null,
    bitbucket: () =>
      bb.data
        ? {
            fullName: bb.data.fullName,
            currentName: bb.data.slug,
            archived: false,
            visibility: bb.data.isPrivate ? "private" : "public",
            webUrl: bb.data.webUrl,
          }
        : null,
  };
  const info = infoFor[provider]();
  if (!info) return null;
  // GitHub admin implies owner; GitLab and Bitbucket both gate the owner-only
  // lifecycle powers on the probe's `admin` flag (owner == admin for Bitbucket).
  const isOwner =
    isGitHub || (isBitbucket ? admin.data?.admin : admin.data?.owner) || false;

  return (
    <div className="space-y-3 rounded-md border border-destructive/40 p-3">
      <h3 className="text-xs font-semibold text-destructive">{t("dangerZoneUi.title")}</h3>
      <RenameAction repoPath={repoPath} info={info} provider={provider} />
      {/* Local detach — any provider, whenever an `upstream` remote exists. */}
      <RemoveUpstreamAction repoPath={repoPath} />
      {/* Leave-fork-network — every provider, gated on persisted fork
          provenance. The row itself branches three ways: an in-app,
          Owner-gated detach on GitLab (real API), and a link-out on GitHub
          (…/settings) and Bitbucket (…/admin), neither of which has a detach
          API. Independent of the upstream-remote gate: a detached fork may
          still have the remote; a remote-less fork may still be in the network. */}
      <LeaveForkNetworkAction
        repoPath={repoPath}
        fullName={info.fullName}
        provider={provider}
        isOwner={isOwner}
      />
      {/* Bitbucket can't archive over the API — hide the row (platform limit). */}
      {!isBitbucket && (
        <>
          <div className="border-t" />
          <ArchiveAction
            repoPath={repoPath}
            info={info}
            isGitLab={isGitLab}
            isOwner={isOwner}
          />
        </>
      )}
      <div className="border-t" />
      <VisibilityAction
        repoPath={repoPath}
        info={info}
        provider={provider}
        isOwner={isOwner}
      />
      <div className="border-t" />
      <TransferAction
        repoPath={repoPath}
        info={info}
        provider={provider}
        isOwner={isOwner}
      />
      <div className="border-t" />
      <DeleteAction
        repoPath={repoPath}
        info={info}
        provider={provider}
        isOwner={isOwner}
        onRepoDeleted={onRepoDeleted}
      />
    </div>
  );
}
