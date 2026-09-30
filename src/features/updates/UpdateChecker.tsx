import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { useTranslation } from "@/lib/i18n";
import { installUpdateWithToast } from "./install";
import { useUpdateCheck } from "./useUpdateCheck";

/**
 * Surfaces a pending update as a persistent, install-on-consent toast. Reads the
 * shared background-polled update query (see {@link useUpdateCheck}), which checks
 * on launch and roughly every six hours while the app stays open, so a release
 * published mid-session is noticed without a restart. The toast fires at most once
 * per newly discovered version: a re-poll finding the same pending version does not
 * re-nag, but a newer version published on top of it toasts again. Failures
 * (offline, no release yet, endpoint not configured) stay quiet — the query does
 * not retry and raises no error UI. Never auto-installs. Mount once at app root.
 */
export function UpdateChecker() {
  const update = useUpdateCheck().data;
  const { locale, t } = useTranslation();
  const notified = useRef<{ version: string; locale: string } | null>(null);

  useEffect(() => {
    if (
      !update ||
      (notified.current?.version === update.version &&
        notified.current.locale === locale)
    )
      return;
    notified.current = { version: update.version, locale };
    toast(t("dataUi.updates.available", { version: update.version }), {
      id: "app-update",
      description: t("dataUi.updates.readyToInstall"),
      duration: Number.POSITIVE_INFINITY,
      action: {
        label: t("dataUi.updates.installAndRestart"),
        onClick: () => void installUpdateWithToast(update),
      },
    });
  }, [update, locale, t]);

  return null;
}
