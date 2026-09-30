import { useRef, useState } from "react";
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
import { useSeedOnOpen } from "@/lib/use-seed-on-open";
import { useTranslation } from "@/lib/i18n";

/** What the pending recovery is for: the lower-case operation word used in the
 *  copy, plus an optional phrase naming its target (e.g. `upstream/main`). */
export interface StashReapplyTarget {
  operationLabel: string;
  detail?: string;
  /** Preposition joining `detail` to the operation word. Defaults to "from";
   *  a rebase runs *onto* its target, so it supplies its own. */
  detailPreposition?: string;
}

/**
 * Offered when git refuses a pull, update, merge, or rebase because it would
 * overwrite uncommitted changes: set them aside, run the operation, put them
 * back. Open when `target` is the pending recovery (null = closed). Also
 * offered proactively by a surface that already knows the tree is dirty.
 * Presentational — the caller owns the compound mutation, the pending flag, and
 * persisting the preference when `always` comes back true.
 */
export function StashReapplyDialog({
  target,
  onCancel,
  onConfirm,
  pending,
}: {
  target: StashReapplyTarget | null;
  onCancel: () => void;
  onConfirm: (always: boolean) => void;
  pending: boolean;
}) {
  const { t } = useTranslation();
  const open = target !== null;
  const [always, setAlways] = useState(false);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const detailPhrase = target?.detail
    ? ` ${t(target.detailPreposition === "onto" ? "branchUi.onto" : "branchUi.from")} ${target.detail}`
    : "";

  // Reset the checkbox each time the dialog opens — it only ever shows while
  // the preference is off, so a remembered tick would be meaningless.
  useSeedOnOpen(open, () => setAlways(false));

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) onCancel();
      }}
    >
      {/* Focus the non-destructive primary so Enter completes the recovery. */}
      <DialogContent initialFocus={() => confirmRef.current}>
        <DialogHeader>
          <DialogTitle>
            {t("branchUi.stashReapplyTitle", { operation: target?.operationLabel ?? "" })}
          </DialogTitle>
          <DialogDescription>
            {t("branchUi.stashReapplyDescription", {
              operation: target?.operationLabel ?? "",
              detailPhrase,
            })}
          </DialogDescription>
        </DialogHeader>
        <label className="flex cursor-pointer items-center gap-2 text-xs">
          <Checkbox
            checked={always}
            onCheckedChange={(v) => setAlways(v === true)}
          />
          {t("branchUi.alwaysStashReapply")}
        </label>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>
            {t("common.cancel")}
          </Button>
          <Button
            ref={confirmRef}
            disabled={pending}
            onClick={() => onConfirm(always)}
          >
            {pending && <Spinner data-icon="inline-start" />}
            {t("branchUi.stashAndReapply")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
