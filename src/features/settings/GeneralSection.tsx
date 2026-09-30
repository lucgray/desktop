import { WarningIcon } from "@phosphor-icons/react";
import { useSelector } from "@tanstack/react-store";
import { openUrl } from "@tauri-apps/plugin-opener";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { PRIVACY_POLICY_URL, resetAnalyticsId } from "@/lib/analytics";
import { useAutomations } from "@/lib/automations/queries";
import { anyAutomationEnabled } from "@/lib/automations/types";
import { withForm } from "@/lib/form";
import type { AUTO_FETCH_INTERVALS } from "@/lib/settings/api";
import { settingsFormOpts } from "./settings-form";
import { useApplyLocale, useSettings } from "@/lib/settings/queries";
import { useTranslation, type TranslationKey } from "@/lib/i18n";

/** Record-typed against AUTO_FETCH_INTERVALS, which `loadSettings` also heals
 *  against, so an added cadence can't reach one without the other. */
const FETCH_INTERVAL_OPTIONS: Record<
  (typeof AUTO_FETCH_INTERVALS)[number],
  TranslationKey
> = {
  "5": "settings.fetchEveryFiveMinutes",
  "10": "settings.fetchEveryTenMinutes",
  "15": "settings.fetchEveryFifteenMinutes",
  "30": "settings.fetchEveryThirtyMinutes",
  "60": "settings.fetchEveryHour",
};

export const GeneralSection = withForm({
  ...settingsFormOpts,
  render: function GeneralSectionRender({ form }) {
    const settings = useSettings();
    const applyLocale = useApplyLocale();
    const { locale, t } = useTranslation();
    const autoFetchOn = useSelector(form.store, (s) => s.values.autoFetch);
    // Keyed off the DRAFT value so the consequence shows before Save commits it, and
    // stands as the standing explanation once hiding AI is saved on.
    const hideAiOn = useSelector(form.store, (s) => s.values.hideAi);
    const automations = useAutomations();
    const automationsPaused =
      hideAiOn &&
      Boolean(automations.data && anyAutomationEnabled(automations.data));
    return (
      <section className="space-y-4">
        <div>
          <h2 className="text-sm font-medium">{t("settings.general")}</h2>
          <p className="text-xs text-muted-foreground">{t("settings.appPreferences")}</p>
        </div>
        <div className="space-y-1.5">
          <label htmlFor="interface-language" className="text-xs font-medium">
            {t("settings.interfaceLanguage")}
          </label>
          <p className="text-xs text-muted-foreground">
            {t("settings.interfaceLanguageDescription")}
          </p>
          <select
            id="interface-language"
            value={locale}
            onChange={(event) => {
              const current = settings.data;
              if (current) applyLocale(current, event.currentTarget.value as "en" | "zh-CN");
            }}
            className="h-8 w-56 rounded-md border border-input bg-background px-2 text-xs"
          >
            <option value="en">{t("common.english")}</option>
            <option value="zh-CN">{t("common.simplifiedChinese")}</option>
          </select>
        </div>
        {/* Each toggle is grouped with its own description (tight spacing) so
            the helper text reads as belonging to the control above it, not the
            next one down. */}
        <div className="space-y-1.5">
          <form.AppField name="hideAi">
            {(field) => (
              <field.CheckboxField
                label={t("settings.hideAi")}
                className="flex cursor-pointer items-center gap-2 text-xs"
              />
            )}
          </form.AppField>
          <p className="text-xs text-muted-foreground">
            {t("generalSettingsHelp.hideAi")}
          </p>
          {automationsPaused && (
            <p
              role="status"
              className="flex items-start gap-1.5 text-xs text-warning"
            >
              <WarningIcon className="size-4 shrink-0" />
              <span>
                {t("generalSettingsHelp.automationsPaused")}
              </span>
            </p>
          )}
        </div>
        <div className="space-y-1.5">
          <form.AppField name="closeToTray">
            {(field) => (
              <field.CheckboxField
                label={t("settings.closeToTray")}
                className="flex cursor-pointer items-center gap-2 text-xs"
              />
            )}
          </form.AppField>
          <p className="text-xs text-muted-foreground">{t("settings.closeToTrayDescription")}</p>
        </div>
        <div className="space-y-1.5">
          <form.AppField name="autoFetch">
            {(field) => (
              <field.CheckboxField
                label={t("settings.autoFetch")}
                className="flex cursor-pointer items-center gap-2 text-xs"
              />
            )}
          </form.AppField>
          <p className="text-xs text-muted-foreground">{t("settings.autoFetchDescription")}</p>
          {autoFetchOn && (
            <div className="max-w-xs pt-1">
              <form.AppField name="autoFetchInterval">
                {(field) => (
                  <field.SelectField items={Object.fromEntries(Object.entries(FETCH_INTERVAL_OPTIONS).map(([k, key]) => [k, t(key)]))} />
                )}
              </form.AppField>
            </div>
          )}
        </div>
        <div className="space-y-1.5">
          <form.AppField name="autoStashOnPull">
            {(field) => (
              <field.CheckboxField
                label={t("settings.autoStash")}
                className="flex cursor-pointer items-center gap-2 text-xs"
              />
            )}
          </form.AppField>
          <p className="text-xs text-muted-foreground">{t("settings.autoStashDescription")}</p>
        </div>
        <div className="space-y-1.5">
          <form.AppField name="reapplyStashOnSwitch">
            {(field) => (
              <field.CheckboxField
                label={t("settings.reapplyStash")}
                className="flex cursor-pointer items-center gap-2 text-xs"
              />
            )}
          </form.AppField>
          <p className="text-xs text-muted-foreground">
            {t("settings.reapplyStashDescription")}
          </p>
        </div>
        <div className="space-y-1.5">
          <form.AppField name="createPrsAsDraft">
            {(field) => (
              <field.CheckboxField
                label={t("settings.draftPrs")}
                className="flex cursor-pointer items-center gap-2 text-xs"
              />
            )}
          </form.AppField>
          <p className="text-xs text-muted-foreground">
            {t("generalSettingsHelp.draftPrs")}
          </p>
        </div>
        <div className="space-y-1.5">
          <form.AppField name="fetchLinkPreviews">
            {(field) => (
              <field.CheckboxField
                label={t("settings.linkPreviews")}
                className="flex cursor-pointer items-center gap-2 text-xs"
              />
            )}
          </form.AppField>
          <p className="text-xs text-muted-foreground">
            {t("generalSettingsHelp.linkPreviews")}
          </p>
        </div>
        <div className="space-y-1.5">
          <form.AppField name="analyticsEnabled">
            {(field) => (
              <field.CheckboxField
                label={t("settings.anonymousUsage")}
                className="flex cursor-pointer items-center gap-2 text-xs"
              />
            )}
          </form.AppField>
          <p className="text-xs text-muted-foreground">
            {t("generalSettingsHelp.analytics")}
          </p>
        </div>
        <div className="space-y-1.5">
          <form.AppField name="recordReplay">
            {(field) => (
              <field.CheckboxField
                label={t("settings.maskedRecordings")}
                className="flex cursor-pointer items-center gap-2 text-xs"
              />
            )}
          </form.AppField>
          <p className="text-xs text-muted-foreground">
            {t("generalSettingsHelp.recordings")}
          </p>
        </div>
        <div className="flex items-center gap-4 pt-1">
          {PRIVACY_POLICY_URL && (
            <button
              type="button"
              className="cursor-pointer text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
              onClick={() => openUrl(PRIVACY_POLICY_URL)}
            >
              {t("settings.privacyPolicy")}
            </button>
          )}
          <Button
            type="button"
            variant="outline"
            size="xs"
            onClick={async () => {
              await resetAnalyticsId();
              toast.success(t("settings.analyticsIdentityReset"), {
                description: t("settings.analyticsIdentityResetDescription"),
              });
            }}
          >
            {t("settings.resetAnalyticsIdentity")}
          </Button>
        </div>
      </section>
    );
  },
});
