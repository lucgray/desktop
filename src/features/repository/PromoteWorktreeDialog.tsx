import { useQuery } from "@tanstack/react-query";
import { useRef } from "react";
import { toast } from "sonner";
import { PathText } from "@/components/path-text";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import {
  opStateOptions,
  repoStatusOptions,
  useUserWorktrees,
} from "@/lib/git/queries";
import type { UserWorktree } from "@/lib/git/worktree";
import { useWorktreeRemovalStore } from "@/lib/stores/worktree-removal";
import { useTranslation } from "@/lib/i18n";

/**
 * Promotes a linked worktree's branch into the MAIN workspace. A branch can only
 * live in one worktree at a time, so promoting is a composite: free the branch
 * (remove the worktree, keep the branch) then check it out in the main checkout.
 *
 * Guards run BEFORE any mutation so a failure never strands the repo — the
 * worktree must be clean (we never discard its work), and the main workspace's
 * own uncommitted changes are stashed first so the checkout can't be blocked.
 * The main workspace is opened first: there's no filesystem watcher (git status
 * is polled), so moving the app off the worktree and letting its last poll
 * settle is what lets the folder delete cleanly — even when you promote the very
 * worktree you're standing in.
 *
 * This dialog only gathers and checks those preconditions. The composite itself
 * is store-owned (`worktree-removal`), so nothing that closes or unmounts this
 * dialog can cut it short — which is why it closes as soon as the store accepts
 * the promote instead of holding the user in a modal for the whole run. Its
 * removal step shows in the repo view's removal line and the manager's row.
 */
export function PromoteWorktreeDialog({
  repoPath,
  worktree,
  onClose,
}: {
  repoPath: string;
  worktree: UserWorktree | null;
  onClose: () => void;
}) {
  return (
    <Dialog open={worktree !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        {worktree && (
          <PromoteBody
            repoPath={repoPath}
            worktree={worktree}
            onClose={onClose}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function PromoteBody({
  repoPath,
  worktree,
  onClose,
}: {
  repoPath: string;
  worktree: UserWorktree;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const worktrees = useUserWorktrees(repoPath);
  const startPromote = useWorktreeRemovalStore((s) => s.startPromote);
  // Synchronous re-entry latch: no re-render separates two clicks in the same
  // tick, so only a ref can refuse the second.
  const runningRef = useRef(false);

  const mainPath = (worktrees.data ?? []).find((w) => w.isMain)?.path ?? null;

  // Preconditions, checked fresh while the dialog is open and sharing the app's
  // status cache (same query key): the worktree must be clean, and we detect the
  // main workspace's own WIP so we can offer to stash it first. Main is gated on
  // its path resolving from the worktree list.
  const wStatus = useQuery(repoStatusOptions(worktree.path));
  const mStatus = useQuery({
    ...repoStatusOptions(mainPath ?? "__pending__"),
    enabled: Boolean(mainPath),
  });
  // Main's in-progress merge/rebase/cherry-pick/revert: the backend refuses to
  // stash over one, and the stash here runs AFTER the worktree is removed — so it
  // has to be a precondition, not an error past the point of no return. The shared
  // options rather than `useOpState` (which takes no `enabled`), because mainPath
  // resolves a tick later from the worktree list.
  const mOpState = useQuery({
    ...opStateOptions(mainPath ?? "__pending__"),
    enabled: Boolean(mainPath),
  });

  const checking =
    worktrees.isPending ||
    wStatus.isPending ||
    (Boolean(mainPath) && (mStatus.isPending || mOpState.isPending));
  const noMain = !worktrees.isPending && !mainPath;
  const worktreeDirty = (wStatus.data?.entries.length ?? 0) > 0;
  const mainDirty = (mStatus.data?.entries.length ?? 0) > 0;
  const mainBranch = mStatus.data?.branch?.name ?? "the default branch";
  const mainMidOp = Boolean(
    mOpState.data?.merging ||
      mOpState.data?.rebasing ||
      mOpState.data?.cherryPicking ||
      mOpState.data?.reverting,
  );
  // `refuse_mid_op` refuses on unmerged index entries too, and that arm has no
  // marker file behind it: a conflicted squash-merge leaves the conflicts with
  // `op_state` all-false, so mirroring only the marker arm would let the stash
  // refuse past the point of no return.
  const mainConflicted = (mStatus.data?.entries ?? []).some(
    (e) => e.staged === "conflicted" || e.unstaged === "conflicted",
  );
  // A failed status read must NOT read as "clean": with `data` undefined the
  // dirty checks silently become false, which would enable Promote with unknown
  // tree state and could skip the main-WIP stash before the checkout.
  const statusError =
    wStatus.isError ||
    (Boolean(mainPath) && (mStatus.isError || mOpState.isError));
  const blocked =
    noMain ||
    statusError ||
    worktreeDirty ||
    mainMidOp ||
    mainConflicted ||
    worktree.isLocked ||
    !worktree.branch;

  function doPromote() {
    if (!mainPath || !worktree.branch || blocked) return;
    if (runningRef.current) return;
    runningRef.current = true;
    // Resolved here, while the dialog still holds its precondition queries; the
    // store runs the composite from there and outlives this dialog.
    const refused = startPromote({
      mainPath,
      worktreePath: worktree.path,
      branch: worktree.branch,
      willStash: mainDirty,
    });
    if (refused) {
      runningRef.current = false;
      toast.info(refused);
      return;
    }
    onClose();
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>{t("worktreeDialog.promoteTitle")}</DialogTitle>
        <DialogDescription>
          {t("worktreeDialog.promoteDescription", { branch: worktree.branch || t("worktreeDialog.thisBranch") })}
        </DialogDescription>
      </DialogHeader>

      <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
        <span className="text-muted-foreground">{t("worktreeDialog.worktree")}</span>
        <PathText path={worktree.path} className="font-mono" />
        <span className="text-muted-foreground">{t("worktreeDialog.mainWorkspace")}</span>
        {mainPath ? (
          <PathText path={mainPath} className="font-mono" />
        ) : (
          <span className="font-mono">—</span>
        )}
      </div>

      {checking ? (
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <Spinner /> {t("worktreeDialog.checkingState")}
        </p>
      ) : statusError ? (
        <p className="text-xs text-warning">
          {t("worktreeDialog.readStateFailed")}
        </p>
      ) : noMain ? (
        <p className="text-xs text-warning">
          {t("worktreeDialog.mainWorkspaceMissing")}
        </p>
      ) : worktreeDirty ? (
        <p className="text-xs text-warning">
          {t("worktreeDialog.worktreeDirty")}
        </p>
      ) : mainMidOp ? (
        <p className="text-xs text-warning">
          {t("worktreeDialog.mainOperationInProgress")}
        </p>
      ) : mainConflicted ? (
        <p className="text-xs text-warning">
          {t("worktreeDialog.mainConflicts")}
        </p>
      ) : worktree.isLocked ? (
        <p className="text-xs text-warning">
          {t("worktreeDialog.worktreeLocked")}
        </p>
      ) : mainDirty ? (
        <p className="text-xs text-info">
          {t("worktreeDialog.mainDirty", { branch: mainBranch })}
        </p>
      ) : null}

      <DialogFooter>
        <Button variant="outline" onClick={onClose}>
          {t("common.cancel")}
        </Button>
        <Button disabled={checking || blocked} onClick={doPromote}>
          {mainDirty && !blocked ? t("worktreeDialog.stashPromote") : t("worktreeDialog.promoteAction")}
        </Button>
      </DialogFooter>
    </>
  );
}
