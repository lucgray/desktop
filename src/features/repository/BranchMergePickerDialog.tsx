import {
  CheckIcon,
  InfoIcon,
  LightningIcon,
  WarningIcon,
} from "@phosphor-icons/react";
import { useEffect, useEffectEvent, useId, useState } from "react";
import { SelectClipText } from "@/components/select-clip-text";
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
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { clipTitleFromText } from "@/lib/clip-title";
import type { MergeConflictStrategy } from "@/lib/git/api";
import { useMergePreview } from "@/lib/git/queries";
import type { Branch } from "@/lib/git/types";
import { useRetained } from "@/lib/use-retained";
import { useTranslation } from "@/lib/i18n";

export type PickerMode = "merge" | "squash" | "rebase";

/** Advanced merge options; `strategy` is meaningful only for a regular merge. */
export interface MergeRunOptions {
  noFf: boolean;
  strategy: MergeConflictStrategy;
}

const PICKER_COPY = {
  merge: { title: "mergeTitle", description: "mergeDescription", action: "mergeAction" },
  squash: { title: "squashTitle", description: "squashDescription", action: "squashAction" },
  rebase: { title: "rebaseTitle", description: "rebaseDescription", action: "rebaseAction" },
} as const;

/** Labels for the on-conflict select — without them Base UI shows the raw value
 *  ("theirs") in the trigger; the popup renders from this map too, so the two
 *  can never drift. */
const CONFLICT_STRATEGY_ITEMS = {
  none: "strategyStop",
  ours: "strategyCurrent",
  theirs: "strategyIncoming",
};

/**
 * The merge / squash / rebase picker. Open when `mode` is set (null = closed).
 * Owns the selected branch, the advanced merge options (merge mode only), and
 * the in-memory conflict preview; the switcher owns the merge/rebase mutations
 * (they feed its `busy` gate) and runs them via `onRun`. On open it seeds the
 * branch to the first available and resets the options.
 */
export function BranchMergePickerDialog({
  repoPath,
  mode,
  onClose,
  onRun,
  otherBranches,
  currentLabel,
}: {
  repoPath: string;
  mode: PickerMode | null;
  onClose: () => void;
  onRun: (mode: PickerMode, branch: string, options: MergeRunOptions) => void;
  otherBranches: Branch[];
  currentLabel: string;
}) {
  const { t } = useTranslation();
  const [pickerBranch, setPickerBranch] = useState("");
  const shownMode = useRetained(mode);
  const branchSelectId = useId();
  const conflictSelectId = useId();
  // Advanced merge options (merge mode only).
  const [mergeNoFf, setMergeNoFf] = useState(false);
  const [mergeStrategy, setMergeStrategy] =
    useState<MergeConflictStrategy>("none");
  // In-memory conflict prediction for the selected branch, while the merge
  // picker is open.
  const mergePreview = useMergePreview(
    repoPath,
    pickerBranch,
    mergeStrategy,
    mode === "merge",
  );

  const seedOnOpen = useEffectEvent(() => {
    setPickerBranch(otherBranches[0]?.name ?? "");
    setMergeNoFf(false);
    setMergeStrategy("none");
  });
  useEffect(() => {
    if (mode !== null) seedOnOpen();
  }, [mode]);

  function runPicker() {
    if (!mode || !pickerBranch) return;
    onRun(mode, pickerBranch, { noFf: mergeNoFf, strategy: mergeStrategy });
  }

  // The merge picker's in-memory conflict prediction, as a calm status line.
  function renderMergePreview() {
    if (mergePreview.isFetching) {
      return (
        <span className="flex items-center gap-1.5 text-muted-foreground">
          <Spinner className="size-3" /> {t("branchMerge.checking")}
        </span>
      );
    }
    const p = mergePreview.data;
    if (!p || p.status === "unknown") return null;
    if (p.status === "fast-forward") {
      // --no-ff suppresses the fast-forward, so reflect that when it's ticked.
      return mergeNoFf ? (
        <span className="flex items-center gap-1.5 text-info">
          <InfoIcon className="size-3.5 shrink-0" /> {t("branchMerge.fastForwardCommit")}
        </span>
      ) : (
        <span className="flex items-center gap-1.5 text-info">
          <LightningIcon className="size-3.5 shrink-0" /> {t("branchMerge.fastForward")}
        </span>
      );
    }
    if (p.status === "up-to-date") {
      return (
        <span className="flex items-center gap-1.5 text-muted-foreground">
          <CheckIcon className="size-3.5 shrink-0" /> {t("branchMerge.upToDate")}
        </span>
      );
    }
    if (p.status === "clean") {
      // The preview already ran with the chosen strategy, so a "clean" result
      // means it really will be clean (any conflicts auto-resolved).
      return (
        <span className="flex items-center gap-1.5 text-success">
          <CheckIcon className="size-3.5 shrink-0" /> {t("branchMerge.cleanMerge")}
        </span>
      );
    }
    // conflict — the preview is strategy-aware, so these are real conflicts that
    // remain even with the chosen strategy ("still" once a strategy can't take
    // them, e.g. structural delete/rename conflicts).
    const n = p.conflicts.length;
    const files = p.conflicts.slice(0, 4).join(", ");
    const more = n > 4 ? `, +${n - 4}` : "";
    return (
      <span className="flex items-start gap-1.5 text-warning">
        <WarningIcon className="mt-px size-3.5 shrink-0" />
        <span>
          {n > 0
            ? t(mergeStrategy !== "none" ? "branchMerge.filesStillConflict" : "branchMerge.filesWillConflict", { count: n })
            : t(mergeStrategy !== "none" ? "branchMerge.mergeStillConflicts" : "branchMerge.mergeWillConflict")}
          {files && `: ${files}${more}`}
        </span>
      </span>
    );
  }

  return (
    <Dialog
      open={mode !== null}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {shownMode ? t(`branchMerge.${PICKER_COPY[shownMode].title}`, { branch: currentLabel }) : ""}
          </DialogTitle>
          <DialogDescription>
            {shownMode ? t(`branchMerge.${PICKER_COPY[shownMode].description}`) : ""}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor={branchSelectId}>{t("branchMerge.branch")}</Label>
          <Select
            items={Object.fromEntries(
              otherBranches.map((b) => [b.name, b.name]),
            )}
            value={pickerBranch || null}
            onValueChange={(v) => v && setPickerBranch(v)}
          >
            <SelectTrigger id={branchSelectId} className="w-full">
              <SelectValue onMouseEnter={clipTitleFromText} />
            </SelectTrigger>
            <SelectContent>
              {otherBranches.map((b) => (
                <SelectItem key={b.name} value={b.name}>
                  <SelectClipText>{b.name}</SelectClipText>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {shownMode === "merge" && (
          <div className="space-y-3">
            <div className="min-h-5 text-xs">{renderMergePreview()}</div>
            <label className="flex cursor-pointer items-center gap-2 text-xs">
              <Checkbox
                checked={mergeNoFf}
                onCheckedChange={(c) => setMergeNoFf(c === true)}
              />
              {t("branchMerge.alwaysMergeCommit")}
            </label>
            <div className="space-y-1.5">
              <Label htmlFor={conflictSelectId} className="text-xs">
                {t("branchMerge.onConflict")}
              </Label>
              <Select
                items={CONFLICT_STRATEGY_ITEMS}
                value={mergeStrategy}
                onValueChange={(v) =>
                  v && setMergeStrategy(v as MergeConflictStrategy)
                }
              >
                <SelectTrigger id={conflictSelectId} className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(CONFLICT_STRATEGY_ITEMS).map(
                    ([strategy, label]) => (
                      <SelectItem key={strategy} value={strategy}>
                        {t(`branchMerge.${label}` as "branchMerge.strategyStop" | "branchMerge.strategyCurrent" | "branchMerge.strategyIncoming")}
                      </SelectItem>
                    ),
                  )}
                </SelectContent>
              </Select>
              {mergeStrategy !== "none" &&
                mergePreview.data?.status !== "fast-forward" &&
                mergePreview.data?.status !== "up-to-date" && (
                  <p className="text-[11px] text-muted-foreground">
                    {t("branchMerge.discardSide", { side: t(mergeStrategy === "ours" ? "branchMerge.incomingSide" : "branchMerge.currentSide") })}
                  </p>
                )}
            </div>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button onClick={runPicker} disabled={!pickerBranch}>
            {shownMode ? t(`branchMerge.${PICKER_COPY[shownMode].action}`) : ""}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
