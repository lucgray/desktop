import { withForm } from "@/lib/form";
import { settingsFormOpts } from "./settings-form";
import { useTranslation } from "@/lib/i18n";

export const InstructionsSection = withForm({
  ...settingsFormOpts,
  render: function InstructionsSectionRender({ form }) {
    const { t } = useTranslation();
    return (
      <section className="space-y-4 border-t pt-4">
        <div>
          <h2 className="text-sm font-medium">{t("settings.instructions")}</h2>
          <p className="text-xs text-muted-foreground">
            {t("instructionsUi.intro")}
          </p>
        </div>
        <form.AppField name="globalInstructions">
          {(field) => (
            <field.TextareaField
              label={t("settings.globalInstructions")}
              rows={6}
              className="max-h-64"
              placeholder={
                t("instructionsUi.globalPlaceholder")
              }
            />
          )}
        </form.AppField>
        <div className="space-y-2">
          <form.AppField name="aiIgnorePatterns">
            {(field) => (
              <field.TextareaField
                label={t("settings.excludedFiles")}
                rows={4}
                className="max-h-48 font-mono"
                placeholder={".agents\n*.lock\ndocs/generated"}
              />
            )}
          </form.AppField>
          <p className="text-xs text-muted-foreground">
            {t("instructionsUi.ignorePatternsHelp", {
              file: "secrets.env",
              rootFile: "/secrets.env",
              folder: "vendor/",
              negation: "!",
              contents: "vendor/*",
              directory: "vendor/",
            })}
          </p>
        </div>
        <p className="text-xs text-muted-foreground">
          {t("instructionsUi.perRepoOverrides", {
            instructions: ".gitdesktop/instructions.md",
            ignore: ".gitdesktop/aiignore",
          })}
        </p>
      </section>
    );
  },
});
