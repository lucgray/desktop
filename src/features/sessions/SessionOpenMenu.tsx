import { CaretDownIcon, FolderOpenIcon } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  openInTerminal,
  openWithDefault,
  openWithProgram,
  revealInExplorer,
} from "@/lib/git/api";
import { useSettings } from "@/lib/settings/queries";
import { toastError } from "@/lib/toast";
import { useTranslation } from "@/lib/i18n";

/**
 * Open a session's worktree so you can inspect the changes — view the files,
 * open it in your editor — before deciding to Keep or Discard. The worktree is a
 * full checkout on the session's branch, isolated from your working tree.
 *
 * For a **container** session the host worktree's deps would be Linux builds (the
 * agent installed them inside the container), wrong on Windows/macOS — so the live
 * test path is the integrated **terminal** (a shell *inside* the image with the
 * worktree mounted), not the host editor/terminal entries, which are hidden here.
 */
export function SessionOpenMenu({
  worktreePath,
  isolation,
}: {
  worktreePath: string;
  isolation: "worktree" | "container";
}) {
  const { t } = useTranslation();
  const settings = useSettings();
  const editorPath = (settings.data?.externalEditor ?? "").trim();
  const editorName =
    (settings.data?.externalEditorName ?? "").trim() || "editor";
  const terminal = (settings.data?.terminal ?? "").trim();
  const terminalPath = (settings.data?.terminalPath ?? "").trim();
  const terminalCommand = (settings.data?.terminalCommand ?? "").trim();
  const onError = (e: unknown) => toastError(e);
  const container = isolation === "container";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<Button variant="outline" size="sm" />}
        title={t("agentUi.openWorktree")}
      >
        <FolderOpenIcon data-icon="inline-start" />
        {t("agentUi.open")}
        <CaretDownIcon className="size-3 opacity-60" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-52">
        {editorPath && (
          <DropdownMenuItem
            onClick={() =>
              openWithProgram(editorPath, worktreePath).catch(onError)
            }
          >
            {t("agentUi.openInEditor", { editor: editorName })}
          </DropdownMenuItem>
        )}
        {/* Host terminal/default are misleading for a container session (host env),
            so only the read-only views (editor / file manager) are offered there.
            The container's live shell is the integrated terminal instead. */}
        {!container && (
          <DropdownMenuItem
            onClick={() =>
              openInTerminal(
                worktreePath,
                terminal || undefined,
                terminalPath || undefined,
                terminalCommand || undefined,
              ).catch(onError)
            }
          >
            {t("agentUi.openInTerminal")}
          </DropdownMenuItem>
        )}
        <DropdownMenuItem
          onClick={() => revealInExplorer(worktreePath).catch(onError)}
        >
          {t("agentUi.revealInFileManager")}
        </DropdownMenuItem>
        {!container && (
          <DropdownMenuItem
            onClick={() => openWithDefault(worktreePath).catch(onError)}
          >
            {t("agentUi.openWithDefault")}
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
