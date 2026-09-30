import { FolderDashedIcon } from "@phosphor-icons/react";
import { useState } from "react";
import {
  RemoveRepoDialog,
  RepoAliasDialog,
} from "@/features/repository/RepoDialogs";
import { RepoList } from "@/features/repository/RepoList";
import type { RecentRepo } from "@/lib/settings/api";
import { useSettings } from "@/lib/settings/queries";
import { useTranslation } from "@/lib/i18n";

export function RecentRepoList() {
  const { t } = useTranslation();
  const settings = useSettings();
  const recents = settings.data?.recentRepos ?? [];
  const [aliasTarget, setAliasTarget] = useState<RecentRepo | null>(null);
  const [removeTarget, setRemoveTarget] = useState<RecentRepo | null>(null);

  return (
    <div className="min-w-0 space-y-2">
      <div className="flex items-baseline justify-between gap-2 px-1">
        <h2 className="font-heading text-sm font-medium">{t("welcome.repositories")}</h2>
        {recents.length > 0 && (
          <span className="text-[11px] tabular-nums text-muted-foreground">
            {recents.length}
          </span>
        )}
      </div>
      {recents.length === 0 ? (
        <div className="flex flex-col items-center gap-2 border border-dashed px-6 py-10 text-center">
          <FolderDashedIcon className="size-6 text-muted-foreground" />
          <p className="text-xs font-medium">{t("welcome.noRepositories")}</p>
          <p className="max-w-[30ch] text-[11px] text-muted-foreground">
            {t("welcome.emptyRepositories")}
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-none border">
          <RepoList
            onAliasRepo={setAliasTarget}
            onRemoveRepo={setRemoveTarget}
          />
        </div>
      )}
      <RepoAliasDialog
        key={aliasTarget?.path ?? "none"}
        repo={aliasTarget}
        onClose={() => setAliasTarget(null)}
      />
      <RemoveRepoDialog
        repo={removeTarget}
        onClose={() => setRemoveTarget(null)}
      />
    </div>
  );
}
