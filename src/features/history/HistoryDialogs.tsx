import { formOptions } from "@tanstack/react-form";
import { type ReactNode, useId } from "react";
import { toast } from "sonner";
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
import { required, withForm } from "@/lib/form";
import type { CherryPickRangeResult } from "@/lib/git/api";
import {
  useCherryPickOnto,
  useDeleteTag,
  useResetToCommit,
} from "@/lib/git/queries";
import { refNameWarning } from "@/lib/git/ref-name";
import { isAppError } from "@/lib/tauri/invoke";
import { toastError, toastErrorWithNote } from "@/lib/toast";
import { useRetained } from "@/lib/use-retained";
import { useTranslation } from "@/lib/i18n";

const onError = (e: unknown) => toastError(e);

/** Confirm-and-delete a tag, optionally on origin too. Owns its mutation; the
 *  parent keeps the open + "delete on origin" state (reset on each open). */
export function DeleteTagDialog({
  repoPath,
  name,
  remote,
  onRemoteChange,
  onClose,
}: {
  repoPath: string;
  name: string | null;
  remote: boolean;
  onRemoteChange: (v: boolean) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const deleteTag = useDeleteTag(repoPath);
  const shownName = useRetained(name);
  async function run() {
    if (!name) return;
    try {
      await deleteTag.mutateAsync({ name, onRemote: remote });
    } catch (e) {
      onError(e);
      onClose();
      return;
    }
    toast.success(t("historyUi.deleteTagSuccess", {
      tag: name,
      remoteNote: remote ? t("historyUi.localAndOriginNote") : "",
    }));
    onClose();
  }
  return (
    <Dialog
      open={name !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("historyUi.deleteTagQuestion", { tag: shownName ?? "" })}</DialogTitle>
          <DialogDescription>
            {t("historyUi.deleteTagDescription")}
          </DialogDescription>
        </DialogHeader>
        <label className="flex cursor-pointer items-center gap-2 text-xs">
          <Checkbox
            checked={remote}
            onCheckedChange={(v) => onRemoteChange(v === true)}
          />
          {t("historyUi.alsoDeleteTagOnOrigin")}
        </label>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t("historyUi.cancel")}
          </Button>
          <Button
            variant="destructive"
            disabled={deleteTag.isPending}
            onClick={() => void run()}
          >
            {deleteTag.isPending && <Spinner data-icon="inline-start" />}
            {t("historyUi.deleteTagAction")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Mixed-reset the current branch to a commit. Owns its mutation. */
export function ResetCommitDialog({
  repoPath,
  hash,
  onClose,
}: {
  repoPath: string;
  hash: string | null;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const resetMutation = useResetToCommit(repoPath);
  const shownHash = useRetained(hash);
  async function run() {
    if (!hash) return;
    try {
      await resetMutation.mutateAsync(hash);
    } catch (e) {
      onError(e);
      onClose();
      return;
    }
    toast.success(t("historyUi.resetSuccess", { hash: hash.slice(0, 7) }));
    onClose();
  }
  return (
    <Dialog
      open={hash !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("historyUi.resetQuestion")}</DialogTitle>
          <DialogDescription>
            {t("historyUi.resetDescription", { hash: shownHash?.slice(0, 7) ?? "" })}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t("historyUi.cancel")}
          </Button>
          <Button
            variant="destructive"
            disabled={resetMutation.isPending}
            onClick={() => void run()}
          >
            {t("historyUi.reset")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Copy one or more commits onto another branch (and switch to it). Owns its
 *  mutation + the run logic; the parent supplies the selected hashes, the
 *  destination-branch state, and the "done" callback that clears the selection. */
export function CherryPickOntoDialog({
  repoPath,
  hashes,
  branch,
  onBranchChange,
  branches,
  currentBranch,
  onClose,
  onDone,
}: {
  repoPath: string;
  hashes: string[] | null;
  branch: string;
  onBranchChange: (b: string) => void;
  branches: { name: string }[];
  currentBranch: string | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const cherryPickOnto = useCherryPickOnto(repoPath);
  const destId = useId();
  const shownHashes = useRetained(hashes);
  const count = shownHashes?.length ?? 0;
  async function run() {
    if (!hashes || !branch) return;
    const target = branch;
    let result: CherryPickRangeResult;
    try {
      result = await cherryPickOnto.mutateAsync({
        hashes,
        targetBranch: target,
      });
    } catch (e) {
      // A paused pick leaves you on the destination branch and closes this
      // dialog, so the toast is the only place left that can say where you
      // are; the generic summary names the operation, never the branch.
      if (isAppError(e) && e.kind === "conflict") {
        toastErrorWithNote(
          e,
          t("historyUi.nowOnBranchResolve", { branch: target }),
        );
      } else {
        onError(e);
      }
      onClose();
      return;
    }
    const { applied, skipped } = result;
    if (applied === 0) {
      toast.info(
        t("historyUi.nothingToCopyOnto", { branch: target }),
      );
    } else {
      const note = skipped > 0 ? t("historyUi.alreadyPresentNote", { count: skipped }) : "";
      toast.success(
        t("historyUi.copiedCommitsOnto", {
          count: applied,
          commitWord: t(applied === 1 ? "historyUi.commitSingular" : "historyUi.commitPlural"),
          branch: target,
          note,
        }),
      );
    }
    onClose();
    onDone();
  }
  return (
    <Dialog
      open={hashes !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("historyUi.cherryPickToBranchTitle")}</DialogTitle>
          <DialogDescription>
            {count > 1 ? (
              <>
                {t("historyUi.cherryPickManyDescription", {
                  count,
                  sourceBranch: currentBranch ?? t("historyUi.thisBranch"),
                })}
              </>
            ) : (
              <>
                {t("historyUi.cherryPickOneDescription", {
                  sourceBranch: currentBranch ?? t("historyUi.thisBranch"),
                })}
              </>
            )}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor={destId}>{t("historyUi.destinationBranch")}</Label>
          <Select
            items={Object.fromEntries(branches.map((b) => [b.name, b.name]))}
            value={branch || null}
            onValueChange={(v) => v && onBranchChange(v)}
          >
            <SelectTrigger id={destId} className="w-full">
              <SelectValue onMouseEnter={clipTitleFromText} />
            </SelectTrigger>
            <SelectContent>
              {branches.map((b) => (
                <SelectItem key={b.name} value={b.name}>
                  <SelectClipText>{b.name}</SelectClipText>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t("historyUi.cancel")}
          </Button>
          <Button
            onClick={() => void run()}
            disabled={!branch || cherryPickOnto.isPending}
          >
            {t("historyUi.cherryPick")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Shared form shape so the parent's `useAppForm` and the `withForm` dialog
 *  agree — used for both "create branch" and "create tag" from a commit. */
export const createRefFromCommitFormOpts = formOptions({
  defaultValues: { name: "" },
});

/**
 * "Create branch from commit" / "Create tag" — one form dialog parameterized by
 * copy. The parent owns the form (it carries the create-branch / create-tag
 * submit + mutation) and the open state; this is the presentational shell.
 */
export const CreateRefFromCommitDialog = withForm({
  ...createRefFromCommitFormOpts,
  props: {
    open: false,
    onClose: () => {
      // Default no-op for type inference; callers always pass a real handler.
    },
    title: "",
    description: null as ReactNode,
    fieldLabel: "",
    placeholder: "",
    submitLabel: "",
  },
  render: function CreateRefFromCommitDialogRender({
    form,
    open,
    onClose,
    title,
    description,
    fieldLabel,
    placeholder,
    submitLabel,
  }) {
    const { t } = useTranslation();
    return (
      <Dialog
        open={open}
        onOpenChange={(o) => {
          if (!o) onClose();
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>{description}</DialogDescription>
          </DialogHeader>
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              form.handleSubmit();
            }}
          >
            <form.AppField
              name="name"
              validators={{ onChange: ({ value }) => required(value) }}
            >
              {(field) => (
                <field.TextField
                  label={fieldLabel}
                  placeholder={placeholder}
                  warning={refNameWarning}
                />
              )}
            </form.AppField>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={onClose}>
                {t("historyUi.cancel")}
              </Button>
              <form.AppForm>
                <form.SubmitButton>{submitLabel}</form.SubmitButton>
              </form.AppForm>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    );
  },
});
