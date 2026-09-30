import { useEffect, useEffectEvent } from "react";
import { toast } from "sonner";
import { SelectClipText } from "@/components/select-clip-text";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { clipTitleFromText } from "@/lib/clip-title";
import { required, useAppForm } from "@/lib/form";
import {
  useGlobalAutocrlf,
  useGlobalDefaultBranch,
  useGlobalIdentity,
  useLocalIdentity,
  useSetGlobalAutocrlf,
  useSetGlobalDefaultBranch,
  useSetGlobalIdentity,
  useSetLocalIdentity,
} from "@/lib/git/queries";
import { toastError } from "@/lib/toast";
import { useTranslation } from "@/lib/i18n";

/** core.autocrlf choices; the sentinel "default" maps to an unset value (Base
 *  UI Select needs a non-empty item value). */
const AUTOCRLF_UNSET = "default";
const AUTOCRLF_OPTIONS = [
  { value: AUTOCRLF_UNSET, labelKey: "autocrlfDefault" },
  {
    value: "true",
    labelKey: "autocrlfTrue",
  },
  {
    value: "input",
    labelKey: "autocrlfInput",
  },
  { value: "false", labelKey: "autocrlfFalse" },
] as const;

/**
 * Global git identity (config --global user.name/email). Lives in gitconfig,
 * not app settings, so it applies immediately with its own Save — same
 * pattern as the API-key form.
 */
export function GitIdentitySection() {
  const { t } = useTranslation();
  const identity = useGlobalIdentity();
  const setIdentity = useSetGlobalIdentity();

  const form = useAppForm({
    defaultValues: { name: "", email: "" },
    onSubmit: async ({ value }) => {
      try {
        await setIdentity.mutateAsync({
          name: value.name.trim(),
          email: value.email.trim(),
        });
        toast.success(t("gitSettings.identityUpdated"));
      } catch (e) {
        toastError(e);
      }
    },
  });

  // Seed once the saved identity arrives. keepDefaultValues: otherwise the
  // per-render options sync clobbers the seeded values (untouched form).
  const seed = useEffectEvent((name: string, email: string) =>
    form.reset({ name, email }, { keepDefaultValues: true }),
  );
  useEffect(() => {
    if (identity.data) seed(identity.data.name, identity.data.email);
  }, [identity.data]);

  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-sm font-medium">{t("settings.gitIdentity")}</h2>
        <p className="text-xs text-muted-foreground">
          {t("gitSettings.identityDescription")}
        </p>
      </div>
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          form.handleSubmit();
        }}
      >
        <div className="grid max-w-xl grid-cols-2 gap-3">
          <form.AppField
            name="name"
            validators={{ onChange: ({ value }) => required(value) }}
          >
            {(field) => (
              <field.TextField label={t("settings.yourName")} placeholder={t("settings.yourName")} />
            )}
          </form.AppField>
          <form.AppField
            name="email"
            validators={{ onChange: ({ value }) => required(value) }}
          >
            {(field) => (
              <field.TextField label={t("settings.email")} placeholder="you@example.com" />
            )}
          </form.AppField>
        </div>
        <form.AppForm>
          <form.SubmitButton>{t("gitSettings.saveIdentity")}</form.SubmitButton>
        </form.AppForm>
      </form>
    </section>
  );
}

/**
 * Default branch for new repositories. Lives in global git config
 * (`init.defaultBranch`), not app settings, so it applies to a command-line
 * `git init` too and has its own Save — same pattern as the git-identity form.
 */
export function GitSection() {
  const { t } = useTranslation();
  const defaultBranch = useGlobalDefaultBranch();
  const setDefaultBranch = useSetGlobalDefaultBranch();

  const form = useAppForm({
    defaultValues: { defaultBranch: "" },
    onSubmit: async ({ value }) => {
      try {
        await setDefaultBranch.mutateAsync(value.defaultBranch.trim());
        toast.success(t("gitSettings.defaultBranchUpdated"));
      } catch (e) {
        toastError(e);
      }
    },
  });

  // Seed once git config arrives. "" (unset) is a valid value, so guard on
  // `!== undefined`, not truthiness. keepDefaultValues: see GitIdentitySection.
  const seed = useEffectEvent((branch: string) =>
    form.reset({ defaultBranch: branch }, { keepDefaultValues: true }),
  );
  useEffect(() => {
    if (defaultBranch.data !== undefined) seed(defaultBranch.data);
  }, [defaultBranch.data]);

  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-sm font-medium">{t("settings.defaultBranch")}</h2>
        <p className="text-xs text-muted-foreground">
          {t("gitSettings.defaultBranchDescription")}
        </p>
      </div>
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          form.handleSubmit();
        }}
      >
        <form.AppField
          name="defaultBranch"
          validators={{ onChange: ({ value }) => required(value) }}
        >
          {(field) => (
            <field.TextField
              label={t("settings.defaultBranchForNewRepos")}
              placeholder="main"
              className="max-w-60 font-mono"
              warning={(value) =>
                value.startsWith("-") || value.trim().includes(" ")
                  ? t("gitSettings.invalidBranchName")
                  : null
              }
            />
          )}
        </form.AppField>
        <form.AppForm>
          <form.SubmitButton>{t("gitSettings.saveDefaultBranch")}</form.SubmitButton>
        </form.AppForm>
      </form>
    </section>
  );
}

/**
 * Global line-ending policy (`git config --global core.autocrlf`). A discrete
 * choice, so it applies on change — no Save button.
 */
export function LineEndingsSection() {
  const { t } = useTranslation();
  const autocrlf = useGlobalAutocrlf();
  const setAutocrlf = useSetGlobalAutocrlf();

  // Map an unknown/unset stored value onto the "default" sentinel for display.
  const raw = autocrlf.data ?? "";
  const value = AUTOCRLF_OPTIONS.some((o) => o.value === raw)
    ? raw
    : AUTOCRLF_UNSET;

  async function change(next: string | null) {
    if (next === null) return;
    try {
      await setAutocrlf.mutateAsync(next === AUTOCRLF_UNSET ? "" : next);
      toast.success(t("gitSettings.lineEndingsUpdated"));
    } catch (e) {
      toastError(e);
    }
  }

  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-sm font-medium">{t("settings.lineEndings")}</h2>
        <p className="text-xs text-muted-foreground">
          {t("gitSettings.lineEndingsDescription")}
        </p>
      </div>
      <Select
        items={Object.fromEntries(AUTOCRLF_OPTIONS.map((o) => [o.value, t(`gitSettings.${o.labelKey}` as "gitSettings.autocrlfDefault" | "gitSettings.autocrlfTrue" | "gitSettings.autocrlfInput" | "gitSettings.autocrlfFalse")]))}
        value={value}
        onValueChange={change}
        disabled={autocrlf.isPending || setAutocrlf.isPending}
      >
        <SelectTrigger className="w-full max-w-md">
          <SelectValue onMouseEnter={clipTitleFromText} />
        </SelectTrigger>
        <SelectContent className="max-w-[min(28rem,80vw)]">
          {AUTOCRLF_OPTIONS.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              <SelectClipText>{t(`gitSettings.${o.labelKey}` as "gitSettings.autocrlfDefault" | "gitSettings.autocrlfTrue" | "gitSettings.autocrlfInput" | "gitSettings.autocrlfFalse")}</SelectClipText>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </section>
  );
}

/**
 * Per-repository identity override (`git config --local user.name/email`) for
 * the open repo. Blank fields clear the override so the repo uses the global
 * identity. Only rendered when a repo is open.
 */
export function RepoIdentitySection({ repoPath }: { repoPath: string }) {
  const { t } = useTranslation();
  const local = useLocalIdentity(repoPath);
  const global = useGlobalIdentity();
  const setLocal = useSetLocalIdentity(repoPath);

  const hasOverride = Boolean(local.data?.name || local.data?.email);
  const globalLabel =
    global.data?.name || global.data?.email
      ? `${global.data.name}${global.data.email ? ` <${global.data.email}>` : ""}`.trim()
      : t("gitSettings.globalIdentity");

  const form = useAppForm({
    defaultValues: { name: "", email: "" },
    onSubmit: async ({ value }) => {
      const name = value.name.trim();
      const email = value.email.trim();
      if (Boolean(name) !== Boolean(email)) {
        toast.error(
          t("gitSettings.identityBothOrNeither"),
        );
        return;
      }
      try {
        await setLocal.mutateAsync({ name, email });
        toast.success(
          name ? t("gitSettings.repoIdentitySet") : t("gitSettings.usingGlobalIdentity"),
        );
      } catch (e) {
        toastError(e);
      }
    },
  });

  // Reseed when the override (or the repo) changes. local.data is always an
  // object once loaded — empty strings mean "no override". keepDefaultValues:
  // see GitIdentitySection.
  const seed = useEffectEvent((name: string, email: string) =>
    form.reset({ name, email }, { keepDefaultValues: true }),
  );
  useEffect(() => {
    if (local.data) seed(local.data.name, local.data.email);
  }, [local.data]);

  async function clear() {
    try {
      await setLocal.mutateAsync({ name: "", email: "" });
      seed("", "");
      toast.success(t("gitSettings.usingGlobalIdentity"));
    } catch (e) {
      toastError(e);
    }
  }

  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-sm font-medium">{t("settings.repoIdentity")}</h2>
        <p className="text-xs text-muted-foreground">
          {t("gitSettings.repoIdentityDescription", { globalLabel })}
        </p>
      </div>
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          form.handleSubmit();
        }}
      >
        <div className="grid max-w-xl grid-cols-2 gap-3">
          <form.AppField name="name">
            {(field) => (
              <field.TextField label={t("settings.yourName")} placeholder={t("settings.yourName")} />
            )}
          </form.AppField>
          <form.AppField name="email">
            {(field) => (
              <field.TextField label={t("settings.email")} placeholder="you@example.com" />
            )}
          </form.AppField>
        </div>
        <div className="flex items-center gap-2">
          <form.AppForm>
            <form.SubmitButton>{t("gitSettings.saveOverride")}</form.SubmitButton>
          </form.AppForm>
          {hasOverride && (
            <Button type="button" variant="outline" size="sm" onClick={clear}>
              {t("gitSettings.useGlobalIdentity")}
            </Button>
          )}
        </div>
      </form>
    </section>
  );
}
