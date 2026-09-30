import {
  CheckCircleIcon,
  CircleDashedIcon,
  CircleIcon,
  CircleNotchIcon,
  MinusCircleIcon,
  ProhibitIcon,
  WarningIcon,
  XCircleIcon,
} from "@phosphor-icons/react";
import type { ForgeProvider } from "@/lib/git/types";
import { isRunActive } from "@/lib/github/actions";
import { cn } from "@/lib/utils";
import { translateCurrent, type TranslationKey } from "@/lib/i18n";

/** Whether a completed conclusion counts as a failure (drives "Re-run failed"). */
export function isFailureConclusion(conclusion: string): boolean {
  return (
    conclusion === "failure" ||
    conclusion === "timed_out" ||
    conclusion === "startup_failure"
  );
}

/** Whether the provider calls its CI unit a pipeline rather than a workflow
 *  run. An unrecognized host routes through `gh`, so it reads as GitHub. */
export function isPipelineProvider(
  provider: ForgeProvider | null | undefined,
): boolean {
  return provider === "gitlab" || provider === "bitbucket";
}

/** What this provider calls one CI unit. Every run-facing label and toast is
 *  built from this, so one surface can never say "run" beside another's
 *  "pipeline". */
export type CiRunNoun = "run" | "pipeline";
export function ciRunNoun(
  provider: ForgeProvider | null | undefined,
): CiRunNoun {
  return isPipelineProvider(provider) ? "pipeline" : "run";
}

/** One re-run the provider offers for a run: the label users read, plus the
 *  kind the caller dispatches. */
export type RerunOffer = {
  kind: "all" | "failed" | "retry" | "bb-rerun";
  label: string;
};

/** What each re-run offer is called. Both offer builders below read these, so
 *  the run views and the PR checks rollup can't spell one operation two ways. */
const RERUN_LABEL_KEYS: Record<RerunOffer["kind"], TranslationKey> = {
  all: "dataUi.ci.rerunAllJobs",
  failed: "dataUi.ci.rerunFailedJobs",
  retry: "dataUi.ci.retryPipeline",
  "bb-rerun": "dataUi.ci.rerunPipeline",
};
const rerunLabel = (kind: RerunOffer["kind"]) => translateCurrent(RERUN_LABEL_KEYS[kind]);

/**
 * The re-run offers for a run, in render order. Shared by the run detail view
 * and the runs-list context menu so the two can't drift on which offers a
 * provider makes or what they're called. An in-flight run offers none of them:
 * Cancel is its only action.
 */
export function rerunOffers(
  provider: ForgeProvider | null | undefined,
  status: string,
  conclusion: string,
): RerunOffer[] {
  // GitLab's retry restarts a pipeline's failed AND canceled jobs, so it covers
  // both conclusions and has no "all jobs" analogue.
  if (provider === "gitlab") {
    return isFailureConclusion(conclusion) || conclusion === "cancelled"
      ? [{ kind: "retry", label: rerunLabel("retry") }]
      : [];
  }
  // Bitbucket has no rerun endpoint — its "rerun" re-triggers the branch
  // pipeline, which makes sense on any finished run (success included).
  if (provider === "bitbucket") {
    return !isRunActive(status) && conclusion !== ""
      ? [{ kind: "bb-rerun", label: rerunLabel("bb-rerun") }]
      : [];
  }
  if (isRunActive(status)) return [];
  const offers: RerunOffer[] = [{ kind: "all", label: rerunLabel("all") }];
  if (isFailureConclusion(conclusion)) {
    offers.push({ kind: "failed", label: rerunLabel("failed") });
  }
  return offers;
}

/** The single re-run the PR checks rollup offers when failed checks exist:
 *  failed-only on GitHub, pipeline retry on GitLab, nothing on Bitbucket (its
 *  rerun re-triggers the branch pipeline — wrong from a PR row). Reads the same
 *  labels rerunOffers renders so the surfaces can't drift. */
export function checksRerunOffer(
  provider: ForgeProvider | null | undefined,
): RerunOffer | null {
  if (provider === "gitlab")
    return { kind: "retry", label: rerunLabel("retry") };
  if (provider === "github")
    return { kind: "failed", label: rerunLabel("failed") };
  return null;
}

/** Every word a per-job re-run needs: the full label, the compact one for a
 *  narrow row, the hover copy that says what the provider actually restarts, and
 *  the started toast. */
export type JobRerunOffer = {
  label: string;
  compactLabel: string;
  title: string;
  toast: string;
};

/**
 * The per-job re-run a provider offers, or null where there is none (Bitbucket
 * steps have no retry endpoint). Shared by the PR checks rollup and the run
 * detail job rows so the two can't drift on the wording.
 *
 * Deliberately a flat bundle rather than the run-level `kind` + `RERUN_TITLES` +
 * `rerunSuccessMessage` split: a job re-run has no `kind` axis to key those
 * records off, so one object keeps all the per-job wording in one place.
 */
export function jobRerunOffer(
  provider: ForgeProvider | null | undefined,
): JobRerunOffer | null {
  if (provider === "github") {
    return {
      label: translateCurrent("dataUi.ci.rerunJob"),
      compactLabel: translateCurrent("dataUi.ci.rerun"),
      title: translateCurrent("dataUi.ci.rerunJobTitle"),
      toast: translateCurrent("dataUi.ci.rerunningJob"),
    };
  }
  if (provider === "gitlab") {
    return {
      label: translateCurrent("dataUi.ci.retryJob"),
      compactLabel: translateCurrent("dataUi.ci.retry"),
      title: translateCurrent("dataUi.ci.retryJobTitle"),
      toast: translateCurrent("dataUi.ci.retryingJobStatus"),
    };
  }
  return null;
}

/** Hover copy per re-run offer, for the two whose label doesn't say what the
 *  provider actually restarts. Shared with the offers themselves so a surface
 *  can't show one without the other. */
const RERUN_TITLE_KEYS: Record<RerunOffer["kind"], TranslationKey | undefined> = {
  all: undefined,
  failed: undefined,
  retry: "dataUi.ci.restartFailedJobs",
  "bb-rerun": "dataUi.ci.triggerBranchPipeline",
};
export function rerunTitle(kind: RerunOffer["kind"]) {
  const key = RERUN_TITLE_KEYS[kind];
  return key ? translateCurrent(key) : undefined;
}

/** The toast a started re-run shows, in the words of the provider's own
 *  operation. */
export function rerunSuccessMessage(
  provider: ForgeProvider | null | undefined,
  failedOnly: boolean,
): string {
  switch (true) {
    case provider === "gitlab":
      return translateCurrent("dataUi.ci.retryingPipeline");
    case provider === "bitbucket":
      return translateCurrent("dataUi.ci.triggeringPipeline");
    case failedOnly:
      return translateCurrent("dataUi.ci.rerunningFailedJobs");
    default:
      return translateCurrent("dataUi.ci.rerunningWorkflow");
  }
}

/** Whether Cancel applies to a run. A manual/blocked GitLab pipeline reports
 *  completed + action_required, but GitLab's cancel endpoint does cancel it. */
export function cancelOffered(
  provider: ForgeProvider | null | undefined,
  status: string,
  conclusion: string,
): boolean {
  return (
    isRunActive(status) ||
    (provider === "gitlab" && conclusion === "action_required")
  );
}

/** What Cancel is called, in the provider's own noun. */
export function cancelLabel(
  provider: ForgeProvider | null | undefined,
): string {
  return translateCurrent(isPipelineProvider(provider) ? "dataUi.ci.cancelPipeline" : "dataUi.ci.cancelRun");
}

/** The toast an accepted cancel shows — same noun as the control the user
 *  clicked. */
export function cancelStartedMessage(
  provider: ForgeProvider | null | undefined,
): string {
  return translateCurrent(isPipelineProvider(provider) ? "dataUi.ci.cancellingPipeline" : "dataUi.ci.cancellingRun");
}

const ACTIVE_STATUS_KEYS: Record<string, TranslationKey> = {
  in_progress: "dataUi.ci.inProgress",
  waiting: "dataUi.ci.waiting",
};
const CONCLUSION_STATUS_KEYS: Record<string, TranslationKey> = {
  success: "dataUi.ci.succeeded",
  failure: "dataUi.ci.failed",
  timed_out: "dataUi.ci.timedOut",
  startup_failure: "dataUi.ci.startupFailure",
  cancelled: "dataUi.ci.cancelled",
  skipped: "dataUi.ci.skipped",
  action_required: "dataUi.ci.actionRequired",
  neutral: "dataUi.ci.neutral",
  stale: "dataUi.ci.stale",
};

/** Human label for a run/job/step's combined status + conclusion. */
export function statusLabel(status: string, conclusion: string): string {
  if (status !== "completed") {
    return translateCurrent(ACTIVE_STATUS_KEYS[status] ?? "dataUi.ci.queued");
  }
  if (CONCLUSION_STATUS_KEYS[conclusion]) return translateCurrent(CONCLUSION_STATUS_KEYS[conclusion]);
  switch (conclusion) {
    default:
      return conclusion || translateCurrent("dataUi.ci.completed");
  }
}

/**
 * Status glyph for a run, job, or step. Active items spin; completed ones show
 * a coloured pass/fail/neutral mark. `weight="bold"` keeps the dashed/notch
 * outlines legible.
 */
export function StatusIcon({
  status,
  conclusion,
  className,
}: {
  status: string;
  conclusion: string;
  className?: string;
}) {
  const base = cn("size-4 shrink-0", className);

  if (status !== "completed") {
    if (status === "in_progress") {
      return (
        <CircleNotchIcon
          weight="bold"
          className={cn(base, "animate-spin text-warning")}
        />
      );
    }
    return (
      <CircleDashedIcon
        weight="bold"
        className={cn(base, "text-muted-foreground")}
      />
    );
  }

  switch (conclusion) {
    case "success":
      return (
        <CheckCircleIcon weight="fill" className={cn(base, "text-success")} />
      );
    case "failure":
    case "timed_out":
    case "startup_failure":
      return (
        <XCircleIcon weight="fill" className={cn(base, "text-destructive")} />
      );
    case "action_required":
      return <WarningIcon weight="fill" className={cn(base, "text-warning")} />;
    case "cancelled":
      return (
        <ProhibitIcon
          weight="bold"
          className={cn(base, "text-muted-foreground")}
        />
      );
    case "skipped":
      return (
        <MinusCircleIcon
          weight="bold"
          className={cn(base, "text-muted-foreground")}
        />
      );
    default:
      return (
        <CircleIcon
          weight="bold"
          className={cn(base, "text-muted-foreground")}
        />
      );
  }
}

export { isRunActive };
