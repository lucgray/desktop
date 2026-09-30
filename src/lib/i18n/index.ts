import { useMemo } from "react";
import { useSettings } from "@/lib/settings/queries";
import en from "./resources/en";
import zhCN from "./resources/zh-CN";
import { queryClient } from "@/lib/query-client";
import type { ActionCategory } from "@/lib/hotkeys/registry";

export type Locale = "en" | "zh-CN";
type NestedResourceKeys<T> = {
  [Key in keyof T & string]: T[Key] extends string
    ? Key
    : `${Key}.${NestedResourceKeys<T[Key]>}`;
}[keyof T & string];
export type TranslationKey = {
  [Group in keyof typeof en]: `${Group}.${NestedResourceKeys<(typeof en)[Group]>}`;
}[keyof typeof en];
type TranslationFunction = (
  key: TranslationKey,
  values?: Record<string, string | number>,
) => string;

const actionCategoryKeys: Record<ActionCategory, TranslationKey> = {
  Application: "hotkeysUi.categories.application",
  Navigation: "hotkeysUi.categories.navigation",
  Repository: "hotkeysUi.categories.repository",
  "Branches & stash": "hotkeysUi.categories.branches",
  Changes: "hotkeysUi.categories.changes",
  Agent: "hotkeysUi.categories.agent",
  "Pull requests": "hotkeysUi.categories.pulls",
  Actions: "hotkeysUi.categories.actions",
};

export function translateActionLabel(id: string, t: TranslationFunction) {
  return t(`hotkeysUi.labels.${id}` as TranslationKey);
}

export function translateActionCategory(
  category: ActionCategory,
  t: TranslationFunction,
) {
  return t(actionCategoryKeys[category]);
}

type ResourceShape<T> = {
  [Key in keyof T]: T[Key] extends string ? string : ResourceShape<T[Key]>;
};
const resources: Record<Locale, ResourceShape<typeof en>> = { en, "zh-CN": zhCN };

export function translate(
  locale: Locale,
  key: TranslationKey,
  values?: Record<string, string | number>,
): string {
  const [group, ...path] = key.split(".") as [keyof typeof en, ...string[]];
  const lookup = (resource: ResourceShape<typeof en>): string | undefined => {
    let value: unknown = resource[group];
    for (const segment of path) {
      if (!value || typeof value !== "object") return undefined;
      value = (value as Record<string, unknown>)[segment];
    }
    return typeof value === "string" ? value : undefined;
  };
  const message = lookup(resources[locale]) ?? lookup(resources.en) ?? key;
  return values
    ? message.replace(/\{([a-zA-Z0-9_]+)\}/g, (match, name: string) =>
        Object.hasOwn(values, name) ? String(values[name]) : match,
      )
    : message;
}

/** Resolves the saved locale for non-component notifications and utility code. */
export function translateCurrent(
  key: TranslationKey,
  values?: Record<string, string | number>,
): string {
  const locale = queryClient.getQueryData<{ locale?: Locale }>(["settings"])?.locale ?? "en";
  return translate(locale, key, values);
}

export function useTranslation() {
  const locale = useSettings().data?.locale ?? "en";
  return useMemo(
    () => ({
      locale,
      t: (key: TranslationKey, values?: Record<string, string | number>) =>
        translate(locale, key, values),
      formatDate: (date: Date, options?: Intl.DateTimeFormatOptions) =>
        new Intl.DateTimeFormat(locale, options).format(date),
      formatNumber: (value: number, options?: Intl.NumberFormatOptions) =>
        new Intl.NumberFormat(locale, options).format(value),
    }),
    [locale],
  );
}
