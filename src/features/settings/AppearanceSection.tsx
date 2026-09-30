import { useId } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useApplyTheme, useSettings } from "@/lib/settings/queries";
import { THEME_ORDER, type ThemeSetting } from "@/lib/theme";
import { useTranslation } from "@/lib/i18n";

/**
 * Settings → Appearance. The theme picker is an apply-on-change preference owned
 * by this control (not the bulk Save bar), mirroring `diffViewMode`: it persists
 * and applies the class immediately, so picking a theme previews it live.
 */
export function AppearanceSection() {
  const { t } = useTranslation();
  const settings = useSettings();
  const applyTheme = useApplyTheme();
  const labelId = useId();
  const theme = settings.data?.theme ?? "system";
  const themeLabels: Record<ThemeSetting, string> = {
    system: t("appearanceHelp.themeSystem"),
    light: t("appearanceHelp.themeLight"),
    dark: t("appearanceHelp.themeDark"),
    slate: t("appearanceHelp.themeSlate"),
  };

  function selectTheme(next: ThemeSetting) {
    if (settings.data) applyTheme(settings.data, next);
  }

  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-sm font-medium">{t("settings.panelAppearance")}</h2>
        <p className="text-xs text-muted-foreground">
          {t("settings.appearanceHelp")}
        </p>
      </div>
      <div className="space-y-1.5">
        <span id={labelId} className="text-xs font-medium">
          {t("settings.theme")}
        </span>
        <div className="max-w-xs">
          <Select
            items={themeLabels}
            value={theme}
            onValueChange={(value) => selectTheme(value as ThemeSetting)}
          >
            <SelectTrigger aria-labelledby={labelId} className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {THEME_ORDER.map((id) => (
                <SelectItem key={id} value={id}>
                  {themeLabels[id]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <p className="text-xs text-muted-foreground">
          <span className="font-medium text-foreground">{themeLabels.system}</span> {t("appearanceHelp.system")}{" "}
          <span className="font-medium text-foreground">{themeLabels.slate}</span> {t("appearanceHelp.slate")}
        </p>
      </div>
    </section>
  );
}
