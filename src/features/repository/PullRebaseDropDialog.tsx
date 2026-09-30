import { useRef } from "react";
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
import type { PullDecision, PullWouldDrop } from "@/lib/git/api";
import { parseableDate } from "@/lib/time";
import { useRetained } from "@/lib/use-retained";
import { useTranslation, type TranslationKey } from "@/lib/i18n";

/** A commit's author date in the user's locale ("Aug 28, 2026"), or `""` when
 *  the payload carried nothing usable. `isPullWouldDrop` deliberately does not
 *  verify this field, so an absent or unparseable one must render as nothing
 *  rather than "Invalid Date". Static per commit — no clock read, no ticker. */
function commitDate(authorDate: string, locale: string): string {
  if (!authorDate || !parseableDate(authorDate)) return "";
  return new Intl.DateTimeFormat(locale, {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(new Date(authorDate));
}

/** Everything an answer says: the verb on its button, the sentence explaining
 *  what that verb does, and the description its success toast carries. TOTAL on
 *  purpose (FORCE_PUSH_DEGRADED's idiom) — a third decision has to fail the
 *  typecheck here rather than ship a face with no copy. The verbs carry the
 *  meaning on their own, so nothing rests on the destructive styling. */
const PULL_DECISION_KEYS: Record<
  PullDecision,
  {
    action: TranslationKey;
    explain: TranslationKey;
    outcome: TranslationKey;
  }
> = {
  keep: {
    action: "pullDrop.keepAction",
    explain: "pullDrop.keepExplanation",
    outcome: "pullDrop.keepOutcomeMany",
  },
  drop: {
    action: "pullDrop.dropAction",
    explain: "pullDrop.dropExplanation",
    outcome: "pullDrop.dropOutcomeMany",
  },
};

/** Keep leads: it is the safe answer and the focused default. */
const DECISION_ORDER = ["keep", "drop"] as const;

export function pullDecisionOutcome(
  t: ReturnType<typeof useTranslation>["t"],
  decision: PullDecision,
  count: number,
): string {
  const outcomeKey = decision === "keep"
    ? count === 1 ? "pullDrop.keepOutcomeOne" : "pullDrop.keepOutcomeMany"
    : count === 1 ? "pullDrop.dropOutcomeOne" : "pullDrop.dropOutcomeMany";
  return t(outcomeKey, { count });
}

/**
 * The keep-or-drop question a rebase pull raises when the upstream was rewritten
 * out from under commits that are still on the branch. Open when `refusal` is
 * the guard's payload (null = closed). Presentational — the guard hook owns the
 * decided mutation and the SHAs, so this can only ever ask about the commits it
 * is showing.
 */
export function PullRebaseDropDialog({
  refusal,
  busy,
  running,
  onCancel,
  onDecide,
}: {
  refusal: PullWouldDrop | null;
  busy: boolean;
  /** Which answer is in flight, for the spinner. Null while idle. */
  running: PullDecision | null;
  onCancel: () => void;
  onDecide: (decision: PullDecision) => void;
}) {
  const { t, locale } = useTranslation();
  const shown = useRetained(refusal);
  const keepRef = useRef<HTMLButtonElement | null>(null);
  const count = shown?.commits.length ?? 0;
  return (
    <Dialog
      open={refusal !== null}
      // Close requests are ignored while the rebase runs: the answer is already
      // acting on the branch, and this dialog still owes the user its outcome.
      onOpenChange={(next) => {
        if (!next && !busy) onCancel();
      }}
    >
      <DialogContent
        className="flex max-h-[85vh] flex-col"
        // The corner X would be dead while the guard above swallows every close
        // path, so it goes away for the duration.
        showCloseButton={!busy}
        initialFocus={() => keepRef.current}
      >
        <DialogHeader>
          <DialogTitle>{t("pullDrop.title")}</DialogTitle>
          <DialogDescription>
            {t(count === 1 ? "pullDrop.upstreamRewrittenOne" : "pullDrop.upstreamRewrittenMany", { upstream: shown?.upstream ?? "", count })}
          </DialogDescription>
        </DialogHeader>

        <div className="flex min-h-0 flex-col gap-3 overflow-y-auto">
          {/* Every commit, never a preview: the surrounding copy promises to
              name them, and the list scrolls rather than truncating. */}
          <ul
            aria-label={t("pullDrop.commitsAtRisk", { count })}
            className="max-h-40 space-y-1 overflow-y-auto rounded-md border bg-muted/30 p-2"
          >
            {shown?.commits.map((c) => {
              const date = commitDate(c.authorDate, locale);
              return (
                <li key={c.sha} className="flex gap-2 text-xs">
                  <span className="shrink-0 font-mono text-muted-foreground">
                    {c.sha.slice(0, 7)}
                  </span>
                  <span className="min-w-0 flex-1 truncate" title={c.subject}>
                    {c.subject}
                  </span>
                  {date !== "" && (
                    <span className="shrink-0 text-muted-foreground">
                      {date}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>

          <dl className="space-y-1.5 text-xs">
            {DECISION_ORDER.map((decision) => (
              <div key={decision} className="flex gap-2">
                <dt className="w-32 shrink-0 font-medium">
                  {t(PULL_DECISION_KEYS[decision].action)}
                </dt>
                <dd className="min-w-0 text-muted-foreground">
                  {t(PULL_DECISION_KEYS[decision].explain, { upstream: shown?.upstream ?? "" })}
                </dd>
              </div>
            ))}
          </dl>
        </div>

        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={onCancel}>
            {t("common.cancel")}
          </Button>
          <Button
            variant="destructive"
            disabled={busy}
            onClick={() => onDecide("drop")}
          >
            {running === "drop" && <Spinner data-icon="inline-start" />}
            {t(PULL_DECISION_KEYS.drop.action)}
          </Button>
          <Button
            ref={keepRef}
            disabled={busy}
            onClick={() => onDecide("keep")}
          >
            {running === "keep" && <Spinner data-icon="inline-start" />}
            {t(PULL_DECISION_KEYS.keep.action)}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
