import { getVersion } from "@tauri-apps/api/app";
import { useEffect, useMemo, useRef, useState } from "react";
import { Markdown } from "@/components/markdown/markdown";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useTranslation } from "@/lib/i18n";
import { useSaveSettings, useSettings } from "@/lib/settings/queries";
import changelogRaw from "../../../CHANGELOG.md?raw";
import changelogZhRaw from "../../../CHANGELOG.zh-CN.md?raw";

/** Pulls the CHANGELOG section for `version` (the `## [x.y.z]` block). */
function changelogSection(version: string, changelog: string): string {
  const lines = changelog.split(/\r?\n/);
  const esc = version.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const header = new RegExp(`^##\\s*\\[${esc}\\]`);
  const start = lines.findIndex((l) => header.test(l));
  if (start === -1) return "";
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^##\s*\[/.test(lines[i])) {
      end = i;
      break;
    }
  }
  return lines
    .slice(start + 1, end)
    .join("\n")
    .trim();
}

/**
 * Shows the changelog once after the app updates to a new version (detected by
 * comparing the running version to the last one we showed). Silent on first
 * run and when the running version has no changelog section.
 */
export function WhatsNew() {
  const { locale, t } = useTranslation();
  const settings = useSettings();
  const saveSettings = useSaveSettings();
  const [open, setOpen] = useState(false);
  const [version, setVersion] = useState("");
  const ranRef = useRef(false);
  const notes = useMemo(
    () =>
      changelogSection(
        version,
        locale === "zh-CN" ? changelogZhRaw : changelogRaw,
      ),
    [version, locale],
  );

  useEffect(() => {
    const data = settings.data;
    if (!data || ranRef.current) return;
    ranRef.current = true;
    getVersion()
      .then((v) => {
        if (data.lastSeenVersion === v) return;
        // Don't pop the dialog on a brand-new install (no prior version seen).
        if (data.lastSeenVersion) {
          const section = changelogSection(
            v,
            locale === "zh-CN" ? changelogZhRaw : changelogRaw,
          );
          if (section) {
            setVersion(v);
            setOpen(true);
          }
        }
        saveSettings.mutate({ ...data, lastSeenVersion: v });
      })
      .catch((error: unknown) => {
        console.error("Could not check release notes:", error);
      });
  }, [settings.data, saveSettings.mutate, locale]);

  if (!notes) return null;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="flex max-h-[80vh] flex-col sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("updatesUi.whatsNew", { version })}</DialogTitle>
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-y-auto">
          <Markdown>{notes}</Markdown>
        </div>
        <DialogFooter>
          <Button onClick={() => setOpen(false)}>{t("updatesUi.gotIt")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
