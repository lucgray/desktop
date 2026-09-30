import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { useEffectEvent } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { required, useAppForm } from "@/lib/form";
import { createRepo, validateRepo } from "@/lib/git/api";
import { useGlobalDefaultBranch } from "@/lib/git/queries";
import { useAddRecentRepo } from "@/lib/settings/queries";
import { useUiStore } from "@/lib/stores/ui";
import { toastError } from "@/lib/toast";
import { useSeedOnOpen } from "@/lib/use-seed-on-open";
import { useTranslation } from "@/lib/i18n";

const NONE = "__none__";
const GITIGNORE_TEMPLATES = ["Node", "Python", "Rust", "Go"];
const LICENSES = ["MIT", "Unlicense"];

function selectItems(values: string[]): Record<string, string> {
  return { [NONE]: "None", ...Object.fromEntries(values.map((v) => [v, v])) };
}

const DEFAULTS = {
  name: "",
  description: "",
  parentDir: "",
  initReadme: true,
  gitignore: NONE,
  license: NONE,
};

export function CreateRepoDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  const openRepo = useUiStore((s) => s.openRepo);
  const addRecent = useAddRecentRepo();
  const globalDefaultBranch = useGlobalDefaultBranch();

  // The branch `git init` uses, from global git config; "main" when unset.
  const defaultBranch = (globalDefaultBranch.data ?? "").trim() || "main";

  const form = useAppForm({
    defaultValues: DEFAULTS,
    onSubmit: async ({ value }) => {
      try {
        const root = await createRepo({
          name: value.name.trim(),
          description: value.description.trim(),
          parentDir: value.parentDir.trim(),
          initReadme: value.initReadme,
          gitignore: value.gitignore === NONE ? null : value.gitignore,
          license: value.license === NONE ? null : value.license,
          defaultBranch,
        });
        const info = await validateRepo(root);
        // Await the recents write so the row exists before RepositoryView mounts
        // and its open-time visibility probe persists onto it (best-effort — a
        // settings-write failure must never block opening the repo).
        await addRecent
          .mutateAsync({ path: info.root, name: info.name })
          .catch(() => undefined);
        onOpenChange(false);
        openRepo(info);
        toast.success(t("createRepo.createdToast", { name: info.name }));
      } catch (e) {
        toastError(e);
      }
    },
  });

  const seedOnOpen = useEffectEvent(() => form.reset(DEFAULTS));
  useSeedOnOpen(open, seedOnOpen);

  async function pickParentDir() {
    const path = await openDialog({
      directory: true,
      title: t("createRepo.createInFolder"),
    });
    if (path) form.setFieldValue("parentDir", path);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            form.handleSubmit();
          }}
        >
          <DialogHeader>
            <DialogTitle>{t("createRepo.title")}</DialogTitle>
            <DialogDescription>
              {t("createRepo.description", { branch: defaultBranch })}
            </DialogDescription>
          </DialogHeader>
          <form.AppField
            name="name"
            validators={{ onChange: ({ value }) => required(value) }}
          >
            {(field) => (
              <field.TextField label={t("createRepo.name")} placeholder={t("createRepo.namePlaceholder")} />
            )}
          </form.AppField>
          <form.AppField name="description">
            {(field) => <field.TextField label={t("createRepo.descriptionLabel")} />}
          </form.AppField>
          <form.AppField
            name="parentDir"
            validators={{ onChange: ({ value }) => required(value) }}
          >
            {(field) => (
              <div className="flex items-end gap-2">
                <div className="flex-1">
                  <field.TextField
                    label={t("createRepo.localPath")}
                    placeholder={t("createRepo.pathPlaceholder")}
                  />
                </div>
                <Button type="button" variant="outline" onClick={pickParentDir}>
                  {t("createRepo.choose")}
                </Button>
              </div>
            )}
          </form.AppField>
          <form.AppField name="initReadme">
            {(field) => (
              <field.CheckboxField
                label={t("createRepo.initializeReadme")}
                className="flex cursor-pointer items-center gap-2 text-xs"
              />
            )}
          </form.AppField>
          <div className="grid grid-cols-2 gap-4">
            <form.AppField name="gitignore">
              {(field) => (
                <field.SelectField
                  label={t("createRepo.gitIgnore")}
                  items={selectItems(GITIGNORE_TEMPLATES)}
                />
              )}
            </form.AppField>
            <form.AppField name="license">
              {(field) => (
                <field.SelectField
                  label={t("createRepo.license")}
                  items={selectItems(LICENSES)}
                />
              )}
            </form.AppField>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              {t("createRepo.cancel")}
            </Button>
            <form.AppForm>
              <form.SubmitButton>{t("createRepo.create")}</form.SubmitButton>
            </form.AppForm>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
