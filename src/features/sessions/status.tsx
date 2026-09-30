import { CheckCircleIcon, WarningCircleIcon } from "@phosphor-icons/react";
import { Spinner } from "@/components/ui/spinner";
import { useTranslation, type TranslationKey } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import type { AgentSession } from "./store";

/**
 * The one status vocabulary for a session, shared by the sidebar row and the
 * canvas header so they never drift. Each kind has a distinct glyph *and* label
 * (never color alone) per the project's WCAG-AA rule:
 *  - working  — a turn is streaming (spinner)
 *  - error    — the latest turn failed for real (a user Cancel is benign, so it
 *               falls through to review/idle rather than reading as a failure)
 *  - review   — there are checkpoint commits to keep/discard (filled dot)
 *  - idle     — nothing to review yet (hollow dot)
 */
export type SessionStatusKind =
  | "working"
  | "error"
  | "review"
  | "idle"
  | "kept";

export function sessionStatus(s: AgentSession): {
  kind: SessionStatusKind;
  labelKey: TranslationKey;
} {
  if (s.running) return { kind: "working", labelKey: "dataUi.sessions.working" };
  if (s.kept) return { kind: "kept", labelKey: "dataUi.sessions.kept" };
  const last = s.turns[s.turns.length - 1];
  if (last?.status === "error" && last.error !== "Cancelled.")
    return { kind: "error", labelKey: "dataUi.sessions.failed" };
  if (s.headHash !== s.base)
    return { kind: "review", labelKey: "dataUi.sessions.readyToReview" };
  return { kind: "idle", labelKey: "dataUi.sessions.noChanges" };
}

function StatusGlyph({ kind }: { kind: SessionStatusKind }) {
  if (kind === "working") return <Spinner className="size-3 text-foreground" />;
  if (kind === "kept")
    return (
      <CheckCircleIcon
        weight="fill"
        className="size-3.5 shrink-0 text-muted-foreground"
      />
    );
  if (kind === "error")
    return (
      <WarningCircleIcon
        weight="fill"
        className="size-3.5 shrink-0 text-destructive"
      />
    );
  if (kind === "review")
    return (
      <span
        className="size-1.5 shrink-0 rounded-full bg-foreground"
        aria-hidden
      />
    );
  return (
    <span
      className="size-1.5 shrink-0 rounded-full border border-muted-foreground"
      aria-hidden
    />
  );
}

/**
 * Icon + label for a session's current state. Meaningful states (working /
 * error / review) use full-contrast `foreground`; only the low-stakes idle
 * state stays muted.
 */
export function StatusIndicator({
  session,
  className,
}: {
  session: AgentSession;
  className?: string;
}) {
  const { kind, labelKey } = sessionStatus(session);
  const { t } = useTranslation();
  return (
    <span
      className={cn(
        "inline-flex min-w-0 items-center gap-1.5",
        kind === "idle" || kind === "kept"
          ? "text-muted-foreground"
          : "text-foreground",
        kind === "error" && "text-destructive",
        className,
      )}
    >
      <StatusGlyph kind={kind} />
      <span className="truncate">{t(labelKey)}</span>
    </span>
  );
}
