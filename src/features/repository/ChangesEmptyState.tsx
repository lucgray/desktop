import {
  ArrowSquareOutIcon,
  CheckCircleIcon,
  ClockCounterClockwiseIcon,
  FolderOpenIcon,
  GitCommitIcon,
  GitPullRequestIcon,
  PencilSimpleIcon,
  TerminalIcon,
} from "@phosphor-icons/react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import {
  forgeRepoUrl,
  openInTerminal,
  openWithDefault,
  openWithProgram,
} from "@/lib/git/api";
import { useSettings } from "@/lib/settings/queries";
import { useUiStore } from "@/lib/stores/ui";
import { toastError } from "@/lib/toast";
import { useTranslation } from "@/lib/i18n";

/**
 * The clean-working-tree view of the Changes panel: first-commit guidance for an
 * unborn repo, otherwise the "all caught up" actions — open a PR when ahead of
 * the default branch, view on GitHub, open in the editor/terminal, view history.
 * Reads its own editor/terminal settings and navigation actions; the parent
 * passes only the change-specific signals it has already computed.
 */
export function ChangesEmptyState({
  repoPath,
  isUnborn,
  ghReady,
  proposeCount,
  currentName,
  defaultName,
}: {
  repoPath: string;
  isUnborn: boolean;
  ghReady: boolean;
  proposeCount: number;
  currentName: string | null;
  defaultName: string | null;
}) {
  const { t } = useTranslation();
  const settings = useSettings();
  const setRepoTab = useUiStore((s) => s.setRepoTab);
  const setCompareBranch = useUiStore((s) => s.setCompareBranch);
  const editorPath = (settings.data?.externalEditor ?? "").trim();
  const editorName =
    (settings.data?.externalEditorName ?? "").trim() || t("changesEmpty.editorFallback");
  const onError = (e: unknown) => toastError(e);

  return (
    <Empty className="flex-1">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          {isUnborn ? <GitCommitIcon /> : <CheckCircleIcon />}
        </EmptyMedia>
        <EmptyTitle>
          {isUnborn ? t("changesEmpty.firstCommitTitle") : t("changesEmpty.noChangesTitle")}
        </EmptyTitle>
        <EmptyDescription>
          {isUnborn
            ? t("changesEmpty.firstCommitDescription")
            : t("changesEmpty.cleanDescription")}
        </EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <div className="flex w-full max-w-60 flex-col gap-2">
          {!isUnborn && proposeCount > 0 && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setCompareBranch(defaultName);
                setRepoTab("compare");
              }}
              title={t("changesEmpty.aheadTitle", { current: currentName ?? "", count: proposeCount, defaultBranch: defaultName ?? "" })}
            >
              <GitPullRequestIcon data-icon="inline-start" />
              {t("changesEmpty.openPullRequest")}
            </Button>
          )}
          {!isUnborn && ghReady && (
            <Button
              variant="outline"
              size="sm"
              className="cursor-pointer"
              onClick={() =>
                forgeRepoUrl(repoPath)
                  .then((url) => openUrl(url))
                  .catch(onError)
              }
            >
              <ArrowSquareOutIcon data-icon="inline-start" />
              {t("changesEmpty.viewOnGitHub")}
            </Button>
          )}
          {editorPath ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                openWithProgram(editorPath, repoPath).catch(onError)
              }
            >
              <PencilSimpleIcon data-icon="inline-start" />
              {t("changesEmpty.openInEditor", { editorName })}
            </Button>
          ) : (
            // No editor configured yet — a folder has no "default editor", so the
            // honest fallback is to reveal the files so they can be opened however
            // the user likes.
            <Button
              variant="outline"
              size="sm"
              onClick={() => openWithDefault(repoPath).catch(onError)}
            >
              <FolderOpenIcon data-icon="inline-start" />
              {t("changesEmpty.showInExplorer")}
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              openInTerminal(
                repoPath,
                settings.data?.terminal,
                settings.data?.terminalPath,
                settings.data?.terminalCommand,
              ).catch(onError)
            }
          >
            <TerminalIcon data-icon="inline-start" />
            {t("changesEmpty.openInTerminal")}
          </Button>
          {!isUnborn && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setRepoTab("history")}
            >
              <ClockCounterClockwiseIcon data-icon="inline-start" />
              {t("changesEmpty.viewHistory")}
            </Button>
          )}
        </div>
      </EmptyContent>
    </Empty>
  );
}
