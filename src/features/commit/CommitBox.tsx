import {
  ArrowsOutSimpleIcon,
  InfoIcon,
  SparkleIcon,
  XIcon,
} from "@phosphor-icons/react";
import { AnimatePresence, m } from "motion/react";
import { DisabledReasonButton } from "@/components/disabled-reason-button";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { formatBinding } from "@/lib/hotkeys/binding";
import { useEffectiveBindings } from "@/lib/hotkeys/hotkeys";
import { useGenerateChordHint } from "@/lib/hotkeys/useGenerateChord";
import { quickTransition } from "@/lib/motion";
import { useUiStore } from "@/lib/stores/ui";
import { cn } from "@/lib/utils";
import { CoAuthorPicker } from "./CoAuthorPicker";
import { useCommitSubmit } from "./useCommitSubmit";
import { useTranslation } from "@/lib/i18n";

export function CommitBox({ repoPath }: { repoPath: string }) {
  const { t } = useTranslation();
  const {
    title,
    body,
    coAuthors,
    setCommitTitle,
    setCommitBody,
    setCoAuthors,
    clearCommitDraft,
    amending,
    amendingHash,
    branchName,
    locked,
    stagedCount,
    canCommit,
    commitDisabledReason,
    commitLabel,
    committing,
    aiEnabled,
    aiConfigured,
    generate,
    cancel,
    generating,
    doCommit,
  } = useCommitSubmit(repoPath);
  const openSettings = useUiStore((s) => s.openSettings);
  const openCommitDialog = useUiStore((s) => s.openCommitDialog);
  // Both button hints read the effective bindings rather than the defaults, so
  // a Settings → Keyboard rebind shows up here; null = the user unbound it and
  // there is no shortcut to name.
  const bindings = useEffectiveBindings();
  const commitBinding = bindings.get("commit") ?? null;
  const popOutBinding = bindings.get("open-commit-dialog") ?? null;
  const generateHint = useGenerateChordHint();

  return (
    <div className="space-y-2 border-t p-3">
      {locked && (
        <div className="bg-muted px-2.5 py-2 text-xs text-muted-foreground">
          <p className="flex items-start gap-2">
            <InfoIcon className="mt-0.5 size-3.5 shrink-0" />
            <span className="flex-1">
              {t("commitUi.lockedBranch", { branch: branchName ?? "" })}
            </span>
          </p>
        </div>
      )}
      {amending && (
        <div className="bg-warning/10 px-2.5 py-2 text-xs text-warning">
          <p className="flex items-start gap-2">
            <InfoIcon className="mt-0.5 size-3.5 shrink-0" />
            <span className="flex-1">
              {t("commitUi.amending", { hash: amendingHash?.slice(0, 7) ?? "" })}{" "}
              <button
                type="button"
                className="font-medium underline underline-offset-2 hover:no-underline"
                onClick={clearCommitDraft}
              >
                {t("commitUi.stopAmending")}
              </button>{" "}
              {t("commitUi.commitSeparately")}
            </span>
          </p>
        </div>
      )}
      <div className="relative">
        <Input
          placeholder={t("commitUi.titlePlaceholder")}
          value={title}
          onChange={(e) => setCommitTitle(e.target.value)}
          disabled={generating}
          className="ph-no-capture pr-12"
          autoComplete="off"
        />
        <span
          className={cn(
            "pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 text-[10px] tabular-nums",
            title.length > 72 ? "text-destructive" : "text-muted-foreground",
          )}
        >
          {title.length > 0 && `${title.length}/72`}
        </span>
      </div>
      <Textarea
        placeholder={t("commitUi.descriptionPlaceholder")}
        value={body}
        onChange={(e) => setCommitBody(e.target.value)}
        disabled={generating}
        rows={4}
        // cap the content-based auto-grow so a long generated body can't
        // swallow the changes list; resize-y lets the user drag it back down
        className="ph-no-capture max-h-48 min-h-16 resize-y"
      />
      {/* The co-authors row carries the pop-out trigger: it is the one row here
          with slack, and the picker wraps its chips rather than filling it. */}
      <div className="flex items-center gap-1">
        <div className="min-w-0 flex-1">
          <CoAuthorPicker
            repoPath={repoPath}
            value={coAuthors}
            onChange={setCoAuthors}
            disabled={generating}
          />
        </div>
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label={t("commitUi.openDialog")}
          title={
            popOutBinding
              ? t("commitUi.openDialogWithShortcut", { shortcut: formatBinding(popOutBinding) })
              : t("commitUi.openDialogPalette")
          }
          onClick={openCommitDialog}
        >
          <ArrowsOutSimpleIcon />
        </Button>
      </div>
      <div className="flex gap-2">
        {aiEnabled && (
          <AnimatePresence mode="wait" initial={false}>
            {generating ? (
              <m.div
                key="cancel"
                initial={{ opacity: 0, scale: 0.96 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.96 }}
                transition={quickTransition}
              >
                <Button variant="outline" size="sm" onClick={cancel}>
                  <XIcon data-icon="inline-start" />
                  {t("common.cancel")}
                </Button>
              </m.div>
            ) : (
              <m.div
                key="generate"
                initial={{ opacity: 0, scale: 0.96 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.96 }}
                transition={quickTransition}
              >
                {aiConfigured ? (
                  <DisabledReasonButton
                    variant="outline"
                    size="sm"
                    disabled={stagedCount === 0}
                    reason={t("commitUi.stageToGenerate")}
                    // The chord is only offered while it would do something — a
                    // disabled Generate's shortcut is dead too.
                    title={
                      stagedCount > 0
                        ? t("commitUi.generateWithAi", { hint: generateHint })
                        : t("commitUi.generateWithAi", { hint: "" })
                    }
                    onClick={generate}
                  >
                    <SparkleIcon data-icon="inline-start" />
                    {t("commitUi.generate")}
                  </DisabledReasonButton>
                ) : (
                  // AI is on but no provider is set up yet — turn the dead-end
                  // Generate click into a one-time path to Settings → AI.
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => openSettings("ai")}
                    title={t("commitUi.setUpAiTitle")}
                  >
                    <SparkleIcon data-icon="inline-start" />
                    {t("commitUi.setUpAi")}
                  </Button>
                )}
              </m.div>
            )}
          </AnimatePresence>
        )}
        <DisabledReasonButton
          size="sm"
          wrapperClassName="min-w-0 flex-1"
          className="min-w-0 flex-1"
          disabled={!canCommit || generating}
          reason={commitDisabledReason}
          title={commitBinding ? formatBinding(commitBinding) : undefined}
          onClick={doCommit}
        >
          {committing && <Spinner data-icon="inline-start" />}
          <span className="truncate">{commitLabel}</span>
        </DisabledReasonButton>
      </div>
    </div>
  );
}
