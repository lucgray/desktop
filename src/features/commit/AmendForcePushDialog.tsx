import { useState } from "react";
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
import { loadSettings } from "@/lib/settings/api";
import { useSaveSettings } from "@/lib/settings/queries";
import { useSeedOnOpen } from "@/lib/use-seed-on-open";
import { useTranslation } from "@/lib/i18n";

/**
 * Asks before amending a commit that's already on the remote, since the
 * rewrite will require a force push. "Don't show again" persists in settings
 * (`confirmAmendForcePush`). Confirming starts the amend.
 */
export function AmendForcePushDialog({
  open,
  upstream,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  upstream: string | null;
  /** Starts the amend, resolving true once it actually began. False covers both
   *  a gate refusal (a branch rule, or a read still settling) and a commit that
   *  couldn't be loaded — either one holds the "Don't show again" write back. */
  onConfirm: () => Promise<boolean>;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const saveSettings = useSaveSettings();
  const [dontShowAgain, setDontShowAgain] = useState(false);

  // Reset the checkbox each time the dialog opens.
  useSeedOnOpen(open, () => setDontShowAgain(false));

  function confirm() {
    // The preference waits on the amend having STARTED: a refusal or an
    // unresolvable commit leaves the prompt in place. `dontShowAgain` stays the
    // click-time value (the user's answer to THIS prompt); the settings object
    // must not — the dialog closes before the amend resolves, so Settings is
    // reachable during the wait and a snapshot from here would write back the
    // pre-edit object. The write is best-effort; the amend already went ahead.
    void (async () => {
      if (!(await onConfirm())) return;
      if (!dontShowAgain) return;
      const fresh = await loadSettings();
      await saveSettings.mutateAsync({
        ...fresh,
        confirmAmendForcePush: false,
      });
    })().catch(() => undefined);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) onCancel();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("commitUi.amendForceTitle")}</DialogTitle>
          <DialogDescription>
            {t("commitUi.amendForceDescription", { upstream: upstream ?? t("commitUi.remote") })}
          </DialogDescription>
        </DialogHeader>
        <label className="flex cursor-pointer items-center gap-2 text-xs">
          <Checkbox
            checked={dontShowAgain}
            onCheckedChange={(v) => setDontShowAgain(v === true)}
          />
          {t("commitUi.dontShowAgain")}
        </label>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>
            {t("common.cancel")}
          </Button>
          <Button onClick={confirm}>{t("commitUi.beginAmend")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
