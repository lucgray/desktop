import { toast } from "sonner";
import { toastError } from "@/lib/toast";
import { translateCurrent } from "@/lib/i18n";
import { installUpdate, type Update } from "@/lib/updater";

/**
 * Installs an update behind a live progress toast, then relaunches. Shared by
 * the launch check and the Settings "Check for updates" button so the install
 * UX is identical wherever the user starts it.
 */
export async function installUpdateWithToast(update: Update): Promise<void> {
  const id = toast.loading(translateCurrent("asyncUi.downloadingUpdate", { version: update.version }));
  try {
    await installUpdate(update, ({ downloaded, total }) => {
      const pct = total ? Math.round((downloaded / total) * 100) : null;
      toast.loading(
        pct !== null
          ? translateCurrent("asyncUi.downloadingUpdateProgress", { version: update.version, percent: pct })
          : translateCurrent("asyncUi.downloadingUpdate", { version: update.version }),
        { id },
      );
    });
    // relaunch() restarts the app, so this rarely shows.
    toast.success(translateCurrent("asyncUi.updateInstalledRestarting"), { id });
  } catch (e) {
    toast.dismiss(id);
    toastError(e);
  }
}
