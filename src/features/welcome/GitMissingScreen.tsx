import { WarningIcon } from "@phosphor-icons/react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { useTranslation } from "@/lib/i18n";

export function GitMissingScreen({ onRetry }: { onRetry: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="flex h-screen items-center justify-center p-8">
      <div className="w-full max-w-md space-y-4">
        <Alert variant="destructive">
          <WarningIcon />
          <AlertTitle>{t("welcome.gitMissing")}</AlertTitle>
          <AlertDescription>
            {t("welcome.gitMissingDescription")}
          </AlertDescription>
        </Alert>
        <div className="flex gap-2">
          <Button onClick={onRetry}>{t("welcome.retry")}</Button>
          <Button
            variant="outline"
            className="cursor-pointer"
            onClick={() => openUrl("https://git-scm.com/downloads")}
          >
            {t("welcome.downloadGit")}
          </Button>
        </div>
      </div>
    </div>
  );
}
