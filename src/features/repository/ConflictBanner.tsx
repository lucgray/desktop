import { InfoIcon, SparkleIcon, WarningIcon } from "@phosphor-icons/react";
import { useState } from "react";
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
import { Spinner } from "@/components/ui/spinner";
import { useOpAbort, useOpContinue, useOpState } from "@/lib/git/queries";
import type { RepoOp, RepoOpState } from "@/lib/git/types";
import { useAiEnabled, useReviewConfigured } from "@/lib/settings/queries";
import { useConflictResolve } from "@/lib/stores/conflict-resolve";
import { toastError } from "@/lib/toast";
import { cn } from "@/lib/utils";
import { useTranslation } from "@/lib/i18n";

const OP_KEYS = {
  merge: { banner: "mergeInProgress", cont: "finishMerge", verb: "merging" },
  rebase: { banner: "rebaseInProgress", cont: "continueRebase", verb: "rebasing" },
  "cherry-pick": { banner: "cherryPickInProgress", cont: "continueCherryPick", verb: "cherryPicking" },
  revert: { banner: "revertInProgress", cont: "continueRevert", verb: "reverting" },
} as const;

/** What Abort undoes, per op. A cherry-pick can be reached from "Cherry-pick to
 *  branch…", which switched branches to get here and whose abort does NOT switch
 *  back — so its copy promises this branch back, never the whole repository. */
const ABORT_DESCRIPTION_KEYS = {
  merge: "abortMergeDescription",
  rebase: "abortRebaseDescription",
  "cherry-pick": "abortCherryPickDescription",
  revert: "abortRevertDescription",
} as const;

/** The `RepoOpState` flags that name an operation. Derived, so a renamed field
 *  breaks here; `editPaused` is excluded because it modifies `rebasing` rather
 *  than naming an op of its own. */
type RepoOpFlag = Exclude<keyof RepoOpState, "editPaused">;

/** Which op the banner names. `RepoOpState`'s flags are independent booleans and
 *  the banner shows one op, so the precedence lives here rather than in a
 *  ternary chain that has to be re-read every time an op is added. */
const OP_BY_FLAG: readonly (readonly [RepoOpFlag, RepoOp])[] = [
  ["merging", "merge"],
  ["rebasing", "rebase"],
  ["cherryPicking", "cherry-pick"],
  ["reverting", "revert"],
];

/**
 * Guides an in-progress merge/rebase/cherry-pick/revert to its end: shows what's
 * mid-flight and how many conflicts remain, with Continue gated on every
 * conflict being resolved (staged) and Abort behind a confirm. Renders
 * nothing when the repo is in a normal state.
 */
export function ConflictBanner({
  repoPath,
  conflictedPaths,
}: {
  repoPath: string;
  conflictedPaths: string[];
}) {
  const { t } = useTranslation();
  const opState = useOpState(repoPath);
  const abortOp = useOpAbort(repoPath);
  const continueOp = useOpContinue(repoPath);
  const aiEnabled = useAiEnabled();
  const reviewConfigured = useReviewConfigured();
  const startAll = useConflictResolve((s) => s.startAll);
  const [confirmAbort, setConfirmAbort] = useState(false);

  const conflictedCount = conflictedPaths.length;
  const op: RepoOp | null =
    OP_BY_FLAG.find(([flag]) => opState.data?.[flag])?.[1] ?? null;
  if (!op && conflictedCount === 0) return null;

  const canResolveWithAi = aiEnabled && reviewConfigured && conflictedCount > 0;

  const busy = abortOp.isPending || continueOp.isPending;
  const onError = (e: unknown) => toastError(e);
  const opVerb = op ? t(`conflictBanner.${OP_KEYS[op].verb}` as "conflictBanner.merging" | "conflictBanner.rebasing" | "conflictBanner.cherryPicking" | "conflictBanner.reverting") : null;
  const conflictText =
    conflictedCount > 0
      ? t("conflictBanner.conflictsCount", { count: conflictedCount })
      : t("conflictBanner.allResolved");
  // A rebase deliberately paused at an `edit` (not a conflict): the user amends
  // the commit via the Changes tab, then continues.
  const editPaused = Boolean(opState.data?.editPaused) && conflictedCount === 0;

  // Awaited rather than per-call callbacks: this banner unmounts the moment the
  // op ends (and rides an <Activity>-hidden tab), and react-query drops per-call
  // callbacks once the observer has no listeners. The op travels as an argument
  // because `op` is nullable at component scope.
  async function doContinue(target: RepoOp) {
    try {
      const recorded = await continueOp.mutateAsync(target);
      // Only a resolution that emptied the pick reaches this: a commit whose
      // changes the destination already had never conflicts, so it is skipped
      // inside the pick itself and never pauses here. The flag speaks for that
      // one pick — a longer sequence may still have applied its remaining
      // commits.
      if (!recorded) {
        toast.info(t("conflictBanner.commitSkipped"));
        return;
      }
      toast.success(
        target === "merge" ? t("conflictBanner.mergeCompleted") : t("conflictBanner.operationContinued", { operation: opVerb ?? "" }),
      );
    } catch (e) {
      onError(e);
    }
  }

  async function doAbort(target: RepoOp) {
    try {
      await abortOp.mutateAsync(target);
      setConfirmAbort(false);
      toast.success(t("conflictBanner.operationAborted", { operation: target }));
    } catch (e) {
      setConfirmAbort(false);
      onError(e);
    }
  }

  return (
    // One calm status line — the per-file resolution actions live in the diff
    // pane's conflict view, so this just carries merge state + Continue/Abort
    // and the batch "Resolve all with AI".
    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b px-3 py-1.5 text-xs">
      <span
        className={cn(
          "flex items-center gap-1.5",
          editPaused ? "text-info" : "text-warning",
        )}
      >
        {editPaused ? (
          <InfoIcon className="size-3.5 shrink-0" />
        ) : (
          <WarningIcon className="size-3.5 shrink-0" />
        )}
        {editPaused
          ? t("conflictBanner.rebasePaused")
          : opVerb
            ? `${opVerb} · ${conflictText}`
            : // No operation to continue or abort (a conflicted stash pop leaves
              // unmerged paths and nothing else), so the banner has to say where
              // the resolution happens.
              t("conflictBanner.resolveInChanges", { conflicts: conflictText })}
      </span>
      <div className="flex items-center gap-1.5">
        {canResolveWithAi && (
          <Button
            size="xs"
            variant="ghost"
            onClick={() => startAll(conflictedPaths, repoPath)}
          >
            <SparkleIcon data-icon="inline-start" />
            {conflictedCount === 1 ? t("conflictBanner.resolveWithAi") : t("conflictBanner.resolveAllWithAi")}
          </Button>
        )}
        {op && (
          <>
            <Button
              variant="outline"
              size="xs"
              disabled={busy}
              onClick={() => setConfirmAbort(true)}
            >
              {t("conflictBanner.abort")}
            </Button>
            <DisabledReasonButton
              size="xs"
              disabled={busy || conflictedCount > 0}
              reason={conflictedCount > 0 ? t("conflictBanner.resolveEveryConflict") : undefined}
              onClick={() => void doContinue(op)}
            >
              {continueOp.isPending && <Spinner data-icon="inline-start" />}
              {t(`conflictBanner.${OP_KEYS[op].cont}` as "conflictBanner.finishMerge" | "conflictBanner.continueRebase" | "conflictBanner.continueCherryPick" | "conflictBanner.continueRevert")}
            </DisabledReasonButton>

            <Dialog open={confirmAbort} onOpenChange={setConfirmAbort}>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>
                    {editPaused ? t("conflictBanner.abortHistoryEditTitle") : t("conflictBanner.abortOperationTitle", { operation: op })}
                  </DialogTitle>
                  <DialogDescription>
                    {editPaused
                      ? t("conflictBanner.abortHistoryEditDescription")
                      : t(`conflictBanner.${ABORT_DESCRIPTION_KEYS[op]}` as "conflictBanner.abortMergeDescription" | "conflictBanner.abortRebaseDescription" | "conflictBanner.abortCherryPickDescription" | "conflictBanner.abortRevertDescription")}
                  </DialogDescription>
                </DialogHeader>
                <DialogFooter>
                  <Button
                    variant="outline"
                    onClick={() => setConfirmAbort(false)}
                  >
                    {t("conflictBanner.keepGoing")}
                  </Button>
                  <Button
                    variant="destructive"
                    disabled={abortOp.isPending}
                    onClick={() => void doAbort(op)}
                  >
                    {abortOp.isPending && <Spinner data-icon="inline-start" />}
                    {t("conflictBanner.abortOperation", { operation: op })}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </>
        )}
      </div>
    </div>
  );
}
